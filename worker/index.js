const groupId = "180446535798602";
const groupUrl = "https://www.facebook.com/groups/" + groupId;
const apiOrigin = "https://api.socialapis.io";
const mcpUrl = "https://mcp.socialapis.io/mcp";
const dayMs = 86400000;

const security = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; worker-src 'self'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com; object-src 'none'; base-uri 'none'; form-action 'self'",
};

function json(body, status = 200) {
  return Response.json(body, { status, headers: security });
}

function failure(message, status) {
  return json({ message }, status);
}

export function normalizePosts(rows, from, to) {
  let rejected = 0;
  let older = 0;
  const posts = [];
  for (const row of rows) {
    const postId = row?.details?.post_id ?? row?.values?.post_id;
    const link = row?.details?.post_link;
    const createdAt = Date.parse(row?.values?.publish_time);
    const match = typeof link === "string" && /^https:\/\/(?:www\.)?facebook\.com\/groups\/180446535798602\/(?:posts|permalink)\/(\d+)\/?(?:[?#].*)?$/.exec(link);
    if (typeof postId !== "string" || !match || match[1] !== postId || !Number.isFinite(createdAt)) {
      rejected++;
      continue;
    }
    if (createdAt < from) {
      older++;
      continue;
    }
    if (createdAt > to) continue;
    const text = typeof row.values.text === "string" ? row.values.text.trim() : "";
    posts.push({
      group_id: groupId, post_id: postId, url: groupUrl + "/posts/" + postId + "/",
      created_at: createdAt, message: text.slice(0, 6000) || "โพสต์มีสื่อประกอบ · เปิดลิงก์เพื่อดู",
      source: "socialapis",
    });
  }
  return { posts, rejected, reachedCutoff: older > 0 && older === rows.length };
}

async function query(request, env) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("Origin") !== origin) return failure("คำขอนี้ต้องมาจากหน้า Tracker", 403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return failure("รูปแบบคำขอไม่ถูกต้อง", 415);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 6000) return failure("คำขอยาวเกินกำหนด", 413);
    body = JSON.parse(raw);
  } catch {
    return failure("รูปแบบคำขอไม่ถูกต้อง", 400);
  }
  if (!body || typeof body !== "object") return failure("รูปแบบคำขอไม่ถูกต้อง", 400);
  const cursor = body.cursor ?? "";
  const until = body.until;
  if (!Number.isSafeInteger(until) || Math.abs(Date.now() - until) > 3600000 ||
      typeof cursor !== "string" || cursor.length > 4000) {
    return failure("ข้อมูลสำหรับ Query ไม่ถูกต้อง ลองเริ่ม Query ใหม่", 400);
  }

  const key = env.SOCIALAPIS_API_KEY || (typeof body.key === "string" ? body.key.trim() : "");
  if (!key) return failure("ระบุ SocialAPIs API key เพื่อเริ่มทดสอบ", 400);
  if (key.length > 500 || /[^\x21-\x7e]/.test(key)) return failure("รูปแบบ API key ไม่ถูกต้อง", 400);

  const from = until - 7 * dayMs;
  const startedAt = Date.now();
  let page;
  try {
    page = await readHostedPosts(key, cursor);
  } catch (error) {
    return mcpFailure(error, startedAt, key);
  }
  const { response, result } = page;
  const upstreamStatus = Number.isInteger(result?.meta?.statusCode) ? result.meta.statusCode : response.status;
  const rows = result?.data?.posts;
  const requestId = [
    response.headers.get("x-request-id"), result?.request_id, result?.requestId, result?.meta?.requestId, result?.meta?.request_id,
  ].map((candidate) => safeRequestId(candidate, key)).find(Boolean) ?? null;
  const providerWarning = response.status === 209 || upstreamStatus === 209;
  if (upstreamStatus !== 200 && !providerWarning) return upstreamStatusFailure(upstreamStatus, startedAt);
  if (!Array.isArray(rows) || (providerWarning && rows.length === 0)) {
    if (providerWarning) {
      return diagnoseEmptyResponse({ key, response, result, upstreamStatus, requestId, startedAt, paginated: Boolean(cursor), charged: page.charged });
    }
    reportUpstreamFailure("posts_missing", startedAt, upstreamStatus, requestId);
    return failure("SocialAPIs ตอบสำเร็จแต่ไม่ส่งรายการโพสต์ของกลุ่ม" + (requestId ? ` (Request ID ${requestId})` : ""), 502);
  }

  const normalized = normalizePosts(rows, from, until);
  const pageInfo = result.data.page_info;
  const paginationValid = typeof pageInfo?.has_next === "boolean" &&
    (!pageInfo.has_next || (typeof pageInfo.end_cursor === "string" && pageInfo.end_cursor.length > 0 && pageInfo.end_cursor !== cursor));
  const issue = !paginationValid && !normalized.reachedCutoff
    ? "SocialAPIs ไม่ได้ส่งข้อมูลหน้าถัดไปที่ใช้ได้"
    : providerWarning ? "SocialAPIs ตอบรหัส 209 แต่มีโพสต์ที่อ่านได้" : null;
  if (issue) reportUpstreamFailure(providerWarning ? "rows_with_209" : "invalid_pagination", startedAt, upstreamStatus, requestId);
  console.log("socialapis_mcp_page", {
    upstreamStatus, posts: normalized.posts.length, charged: page.charged, paginated: Boolean(cursor),
  });
  return json({
    ...normalized,
    next: !normalized.reachedCutoff && paginationValid && pageInfo.has_next ? pageInfo.end_cursor : null,
    warning: issue ? issue + (requestId ? ` (Request ID ${requestId})` : "") : null,
    credits: page.remaining,
    charged: page.charged,
  });
}

class McpRequestError extends Error {
  constructor(stage, status, payload) {
    super("Hosted MCP request failed");
    this.stage = stage;
    this.status = status;
    this.payload = payload;
  }
}

async function mcpPost(session, method, params, id, timeout = 9000) {
  try {
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: session.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({ jsonrpc: "2.0", method, ...(id === undefined ? {} : { id }), ...(params ? { params } : {}) }),
    });
    if (!response.ok) throw new McpRequestError(method, response.status);
    if (id === undefined) return { response };
    const message = await response.json();
    if (message?.id !== id || message?.error || !message?.result) {
      throw new McpRequestError(method, response.status, message?.error);
    }
    return { response, result: message.result };
  } catch (error) {
    if (error instanceof McpRequestError) throw error;
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new McpRequestError(method, timedOut ? 504 : null);
  }
}

async function openMcp(key) {
  const session = { headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(key ? { Authorization: "Bearer " + key } : {}),
  } };
  const { response, result } = await mcpPost(session, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "Facebook Group Operation Tracker", version: "1.0" },
  }, 1);
  if (!["2025-03-26", "2025-06-18", "2025-11-25"].includes(result.protocolVersion)) {
    throw new McpRequestError("initialize", response.status);
  }
  session.headers["Mcp-Protocol-Version"] = result.protocolVersion;
  const sessionId = response.headers.get("mcp-session-id");
  if (sessionId) session.headers["Mcp-Session-Id"] = sessionId;
  await mcpPost(session, "notifications/initialized");
  return session;
}

function mcpTextResult(value) {
  const text = value.content?.find((item) => item?.type === "text" && typeof item.text === "string")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function creditValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function readHostedPosts(key, cursor) {
  const session = await openMcp(key);
  const { response, result: value } = await mcpPost(session, "tools/call", {
    name: "facebook_group",
    arguments: {
      action: "posts", link: groupUrl + "/", limit: 3, timezone: "UTC",
      ...(cursor ? { end_cursor: cursor } : {}),
    },
  }, 2, 95000);
  const result = value.structuredContent?.result ?? mcpTextResult(value);
  if (!result || (value.isError && result?.meta?.statusCode !== 209)) {
    throw new McpRequestError("tools/call", result?.meta?.statusCode ?? response.status, result);
  }
  return {
    response, result,
    charged: creditValue(value.structuredContent?.creditsCharged ?? result?.meta?.creditsCharged),
    remaining: creditValue(value.structuredContent?.creditsRemaining ?? result?.meta?.creditsRemaining),
  };
}

function mcpFailure(error, startedAt, key = "") {
  const stage = error?.stage ?? "unknown";
  const status = Number.isInteger(error?.status) ? error.status : null;
  console.warn("socialapis_mcp_failed", { stage, status, elapsedMs: Date.now() - startedAt });
  if ([401, 403].includes(status)) return failure("SocialAPIs ไม่อนุญาตคำขอ ตรวจสอบคีย์และสิทธิ์ของบัญชี", 502);
  if ([402, 429].includes(status)) return failure("SocialAPIs จำกัดคำขอหรือเครดิตไม่พอ", 429);
  const detail = key ? safeProviderMessage(error?.payload, key) : "";
  const title = stage === "tools/call" ? "SocialAPIs MCP ดึงโพสต์ไม่สำเร็จ" : "Tracker เชื่อมต่อ SocialAPIs MCP ไม่สำเร็จ";
  return failure([title, status ? `HTTP ${status}` : "", detail].filter(Boolean).join(" · "), status === 504 ? 504 : 502);
}

async function probeMcpTransport() {
  const startedAt = Date.now();
  try {
    const session = await openMcp();
    const { result } = await mcpPost(session, "tools/list", {}, 2);
    const groups = result.tools?.find((tool) => tool.name === "facebook_group");
    if (!groups?.inputSchema?.properties?.action?.enum?.includes("posts")) {
      throw new McpRequestError("tools/list", 200);
    }
    return json({ ready: true, tool: "facebook_group", action: "posts", protocol: session.headers["Mcp-Protocol-Version"] });
  } catch (error) {
    return mcpFailure(error, startedAt);
  }
}

async function diagnoseEmptyResponse({ key, response, result, upstreamStatus, requestId, startedAt, paginated, charged }) {
  const usage = await checkProviderUsage(key);
  const detail = safeProviderMessage(result, key);
  const diagnosticId = crypto.randomUUID().slice(0, 8);
  console.warn("socialapis_209_diagnostic", {
    diagnosticId, requestId, feedHttp: response.status,
    feedCode: Number.isInteger(upstreamStatus) ? upstreamStatus : null,
    feedShape: Array.isArray(result?.data?.posts) ? "empty_posts" : "posts_missing",
    accountHttp: usage.http, accountCode: usage.code, accountCheck: usage.state,
    paginated, charged, via: "hosted_mcp", elapsedMs: Date.now() - startedAt,
  });
  const segments = [
    usage.state === "accepted"
      ? "SocialAPIs ยืนยันว่าใช้ API key ได้ แต่คำขอโพสต์ของกลุ่มนี้คืนรหัส 209 และไม่มีโพสต์"
      : usage.state === "rejected"
        ? "SocialAPIs ปฏิเสธ API key ตอนตรวจบัญชี คัดลอก API key จาก Dashboard แล้วลองใหม่"
        : "คำขอโพสต์คืนรหัส 209 และยังตรวจบัญชี SocialAPIs ไม่สำเร็จ",
    `ฟีด HTTP ${response.status}${response.status !== upstreamStatus && Number.isInteger(upstreamStatus) ? ` / รหัส ${upstreamStatus}` : ""}`,
    usage.http ? `บัญชี HTTP ${usage.http}${usage.code && usage.code !== usage.http ? ` / รหัส ${usage.code}` : ""}` : "",
    detail,
    charged === null ? "" : `ผู้ให้บริการรายงานใช้ ${charged} เครดิต`,
    requestId ? `Request ID ${requestId}` : "",
    `รหัสตรวจสอบ ${diagnosticId}`,
  ];
  return failure(segments.filter(Boolean).join(" · "), 502);
}

async function checkProviderUsage(key) {
  let http = null;
  try {
    const response = await fetch(apiOrigin + "/usage", {
      headers: { "x-api-token": key, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
    });
    http = response.status;
    if (http === 401 || http === 403) return { state: "rejected", http, code: null };
    if (http !== 200) return { state: "unknown", http, code: null };
    const value = await response.json();
    const reported = value?.meta?.statusCode ?? value?.statusCode;
    const code = Number.isInteger(reported) ? reported : null;
    if (code === 401 || code === 403) return { state: "rejected", http, code };
    const accepted = Boolean(value && !Array.isArray(value) && typeof value === "object" &&
      !value.error && value.success !== false && (code === null || code === 200));
    return { state: accepted ? "accepted" : "unknown", http, code };
  } catch {
    return { state: "unknown", http, code: null };
  }
}

function safeProviderMessage(result, key) {
  const message = [result?.error?.message, result?.message, result?.error].find((value) => typeof value === "string");
  if (!message) return "";
  const clean = message
    .replaceAll(key, "[redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[link]")
    .replace(/[A-Za-z0-9_+./=-]{20,}/g, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  return clean ? "SocialAPIs: " + clean.slice(0, 180) : "";
}

function safeRequestId(value, key) {
  return typeof value === "string" && !value.includes(key) && /^[A-Za-z0-9_-]{1,96}$/.test(value) ? value : null;
}

function reportUpstreamFailure(reason, startedAt, status = null, requestId = null) {
  console.warn("socialapis_query_failed", {
    reason, status: Number.isInteger(status) ? status : null, elapsedMs: Date.now() - startedAt, requestId,
  });
}

function upstreamStatusFailure(status, startedAt) {
  reportUpstreamFailure("upstream_status", startedAt, status);
  if ([401, 403].includes(status)) return failure("SocialAPIs ปฏิเสธคำขอ ตรวจสอบ API key หรือสิทธิ์ของบัญชี", 502);
  if ([402, 429].includes(status)) return failure("SocialAPIs จำกัดคำขอหรือเครดิตไม่พอ ตรวจสอบบัญชีก่อนลองใหม่", 429);
  const label = Number.isInteger(status) ? ` (HTTP ${status})` : "";
  return failure("SocialAPIs อ่านกลุ่มนี้ไม่สำเร็จ" + label, 502);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/posts") return sharedPostsApi(request, env);
    if (path.startsWith("/api/facebook/")) {
      if (!request.headers.get("oai-authenticated-user-id")) return failure("กรุณาเข้าสู่ระบบ Tracker", 401);
      if (path === "/api/facebook/status" && request.method === "GET") return json({ configured: Boolean(env.SOCIALAPIS_API_KEY) });
      if (path === "/api/facebook/query" && request.method === "POST") return query(request, env);
      if (path === "/api/facebook/transport-check" && request.method === "GET") return probeMcpTransport();
      return failure("ไม่พบเส้นทางที่ร้องขอ", 404);
    }
    const asset = siteAssets[path === "/" ? "/index.html" : path];
    if (asset && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(request.method === "HEAD" ? null : asset.body, {
        headers: { ...security, "Content-Type": asset.type },
      });
    }
    return new Response("Not found", { status: 404, headers: security });
  },
};
