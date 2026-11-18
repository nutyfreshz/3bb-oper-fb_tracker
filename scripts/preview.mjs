import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import "./build.mjs";

const { default: worker } = await import("../dist/server/index.js");

const { values } = parseArgs({ options: { host: { type: "string" }, port: { type: "string" }, strictPort: { type: "boolean" } } });
const base = "https://www.facebook.com/groups/180446535798602/permalink/";
const fixtureTime = Date.now();
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(await readFile(new URL("../drizzle/0000_shared_posts.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("../drizzle/0001_technician_concern.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("../drizzle/0002_post_topics.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("../drizzle/0003_follow_up.sql", import.meta.url), "utf8"));
const db = {
  prepare(sql) {
    const stmt = sqlite.prepare(sql);
    return {
      bind(...values) {
        return {
          all: () => ({ results: stmt.all(...values) }),
          run: () => ({ meta: { changes: stmt.run(...values).changes } }),
        };
      },
    };
  },
  batch(statements) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.run());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
};
function sample(id, time) {
  return {
    details: { post_id: id, post_link: base + id + "/" },
    values: { publish_time: new Date(time).toISOString(), text: id === "900001" ? "ช่างไม่มาตามวันนัดติดตั้ง" : "รบกวนสอบถามบิลรายเดือน" },
    user_details: { id: "Excluded from Tracker" },
  };
}

globalThis.fetch = async (target, options) => {
  if (target !== "https://mcp.socialapis.io/mcp" || options.method !== "POST" || options.redirect !== "manual") {
    throw new Error("Unexpected test URL or method");
  }
  const call = JSON.parse(options.body);
  const reply = (result) => Response.json({ jsonrpc: "2.0", id: call.id, result });
  if (call.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} } });
  if (call.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (call.method === "tools/list") return reply({
    tools: [{ name: "facebook_group", inputSchema: { properties: { action: { enum: ["posts"] } } } }],
  });
  if (call.method !== "tools/call" || call.params.name !== "facebook_group") throw new Error("Unexpected test tool");
  if (options.headers.Authorization !== "Bearer qa-key") return new Response(null, { status: 401 });
  const { action, link, limit, timezone, end_cursor: cursor } = call.params.arguments;
  if (action !== "posts" || link !== base.replace("permalink/", "") || limit !== 3 || timezone !== "UTC") {
    throw new Error("Unexpected group posts arguments");
  }
  const before = Date.now();
  const after = before - 7 * 86400000;
  const recent = sample("900001", fixtureTime - 3600000);
  const posts = cursor === "qa-old" ? [sample("900003", after - 60000)] :
    cursor ? [recent, sample("900002", fixtureTime - 7200000)] : [recent];
  return reply({
    structuredContent: {
      result: {
        data: { page_info: { has_next: true, end_cursor: cursor === "qa-old" ? "should-not-be-read" : cursor ? "qa-old" : "qa-next" }, posts },
        meta: { statusCode: 200 },
      },
      creditsCharged: 1,
      creditsRemaining: cursor === "qa-old" ? 197 : cursor ? 198 : 199,
    },
  });
};

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers(req.headers);
    headers.set("oai-authenticated-user-id", "preview-user");
    const request = new Request("http://" + req.headers.host + req.url, {
      method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await worker.fetch(request, { DB: db });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("Preview request failed");
  }
}).listen(Number(values.port ?? process.env.PORT ?? 4173), values.host ?? "0.0.0.0", () => {
  console.log("Tracker preview ready with synthetic upstream responses");
});
