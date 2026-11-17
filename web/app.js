import {
  groups, latestLiveRows, makeFeed, parsePostLink, postKey,
  runQuery, saveRealPost,
} from "./data.mjs";

const outlines = {
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>',
  flask: '<path d="M9 3h6m-5 0v7l-6 9a1 1 0 0 0 .8 2h14.4a1 1 0 0 0 .8-2l-6-9V3M7.5 15h9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  group: '<circle cx="9" cy="8" r="3"/><path d="M3 19v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m2-6a4 4 0 0 1 4 4v2M16 5a3 3 0 0 1 0 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
  link: '<path d="M10 13a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1m2 6a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
};

const byId = (id) => document.getElementById(id);
const storageKey = "facebook-group-operation-tracker:v1";
const dateFormat = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});
const realDateFormat = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric",
});
const groupNames = new Map(groups.map((group) => [group.id, group.name]));

function hydrate() {
  const initial = {
    connected: false, selected: [], days: 7, result: null, statuses: {},
    anchor: Date.now(),
    real: {}, lastLiveQuery: null, legacyQuery: null, pendingQuery: null, mcpVerified: false,
  };
  try {
    const { lastSheetQuery, lastSheetSync, ...saved } = JSON.parse(localStorage.getItem(storageKey)) ?? {};
    const legacyQuery = lastSheetQuery ?? (saved.lastLiveQuery?.sample === false ? saved.lastLiveQuery : null);
    return { ...initial, legacyQuery, ...saved };
  } catch {
    return initial;
  }
}

const state = hydrate();
const feed = makeFeed(state.anchor);
const posts = new Map(feed.map((post) => [postKey(post), post]));
let filter = "all";
let source = "real";
let realLookback = "7";
let runtimeKey = "";
let configured = false;
let querying = false;
let savingPosts = false;
let sharedRows = [];
let nextPage = null;
let readSequence = 0;
let readingPosts = true;
let showingSample = false;
let updatingStatus = "";
let samplePage = null;
let noticeTimer;
let storageAvailable = true;

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    storageAvailable = false;
  }
}

function announce(message) {
  const notice = byId("notice");
  clearTimeout(noticeTimer);
  notice.textContent = storageAvailable ? message : message + " · เบราว์เซอร์ไม่อนุญาตให้บันทึกข้ามการรีเฟรช";
  notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 4200);
}

function drawIcons(container = document) {
  for (const node of container.querySelectorAll("[data-icon]:empty")) {
    node.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + outlines[node.dataset.icon] + '</svg>';
  }
}

function statusFor(key) {
  return state.statuses[key] === "fixed" ? "fixed" : "pending";
}

function escapeText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function currentRows() {
  if (source === "real") {
    return showingSample ? latestLiveRows(state.real, state.lastLiveQuery) : sharedRows;
  }
  return (state.result?.keys ?? []).map((key) => ({ ...posts.get(key), fix_status: statusFor(key) }));
}

function drawSetup() {
  const current = !state.connected ? 0 : state.selected.length === 0 ? 1 : 2;
  byId("stepper").innerHTML = ["Connect Facebook", "Select groups", "Query posts"].map((label, index) => {
    const done = index < current || (index === 2 && sameQuery());
    const active = index === current && !done;
    return `<div class="step ${done ? "done" : active ? "active" : ""}" ${active ? 'aria-current="step"' : ""}><span class="step-index">${done ? '<span data-icon="check" aria-label="Completed"></span>' : index + 1}</span>${label}</div>`;
  }).join("");
  const button = state.connected ? '<span class="connected">● Connected · Mock</span>' :
    '<button type="button" class="button primary" id="connect-button"><span data-icon="link"></span> Connect Facebook</button>';
  byId("setup").innerHTML = `<div class="setup-body">
    <div class="connect-row"><div class="connect-meta"><span class="facebook-icon" aria-hidden="true">f</span><div><h3>${state.connected ? "Demo Facebook account" : "Facebook connection"}</h3><p>${state.connected ? "เชื่อมต่อแล้ว · มีกลุ่มตัวอย่าง 3 กลุ่ม" : "ทดลองเชื่อมต่อด้วยบัญชีจำลอง"}</p></div></div>${button}</div>
    ${state.connected ? groupControls() : ""}
  </div>`;
  drawIcons(byId("workflow"));
}

function sameQuery() {
  return state.result?.days === state.days && groups.every(({ id }) =>
    state.result.groupIds.includes(id) === state.selected.includes(id));
}

function groupControls() {
  const options = groups.map(({ id, name, detail }) => `<label class="group-option">
    <input type="checkbox" data-group="${id}" ${state.selected.includes(id) ? "checked" : ""}>
    <span><strong>${name}</strong><small>${detail}</small></span><span class="group-icon" data-icon="group"></span>
  </label>`).join("");
  return `<div class="group-zone">
    <div class="group-heading"><div><strong>เลือกกลุ่ม</strong><small id="selected-count">เลือก ${state.selected.length} จาก ${groups.length} กลุ่ม</small></div><button type="button" class="button faint" id="toggle-groups">${state.selected.length === groups.length ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}</button></div>
    <div class="group-grid">${options}</div>
    <div class="query-controls">
      <div class="range"><label for="lookback">ดึงโพสต์ย้อนหลัง</label><select id="lookback">${[3, 7, 14, 30].map((days) => `<option value="${days}" ${state.days === days ? "selected" : ""}>${days} วัน</option>`).join("")}</select></div>
      <button type="button" class="button primary" id="query-button" ${state.selected.length ? "" : "disabled"}><span data-icon="search"></span> ${state.result ? "Re-query posts" : "Query posts"}</button>
    </div>
  </div>`;
}

function drawResults() {
  const rows = currentRows();
  const fixed = rows.filter((post) => post.fix_status === "fixed").length;
  const visibleRows = rows.filter((post) => filter === "all" || post.fix_status === filter);
  const { result } = state;
  const isReal = source === "real";
  const hasResults = isReal || Boolean(result);
  byId("duplicate-metric").hidden = isReal;
  byId("real-range").hidden = !isReal;
  byId("stat-total").textContent = hasResults ? rows.length : "—";
  byId("stat-pending").textContent = hasResults ? rows.length - fixed : "—";
  byId("stat-fixed").textContent = hasResults ? fixed : "—";
  byId("stat-duplicates").textContent = result ? result.duplicates : "—";
  byId("query-caption").textContent = isReal
    ? showingSample ? "ทดสอบเฉพาะหน้าแรก · ยังไม่บันทึกเข้าข้อมูลทีม" : "โพสต์และสถานะที่ใช้ร่วมกันในทีม"
    : result
    ? `ย้อนหลัง ${result.days} วัน · ${result.groupIds.length} กลุ่ม · Query ล่าสุด ${dateFormat.format(result.time)} (เวลาไทย)`
    : "โพสต์จากการ Query ล่าสุด";
  byId("row-count").textContent = hasResults ? `แสดง ${visibleRows.length} จาก ${rows.length} โพสต์` : "";
  const exportButton = byId("posts-export-button");
  exportButton.hidden = !isReal;
  exportButton.disabled = !isReal || !state.lastLiveQuery || latestLiveRows(state.real, state.lastLiveQuery).length === 0;
  byId("shared-log").hidden = !isReal;
  byId("posts-refresh-button").hidden = !isReal;
  byId("posts-refresh-button").disabled = readingPosts || Boolean(updatingStatus);
  byId("posts-more-button").hidden = !isReal || showingSample || !nextPage;
  byId("posts-more-button").disabled = readingPosts || Boolean(updatingStatus);
  updateImportButton();
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
  });
  if (!visibleRows.length) {
    let title = "ไม่มีโพสต์ในสถานะนี้";
    let message = "เลือกดูสถานะอื่นได้จากตัวกรองด้านบน";
    if (isReal && !rows.length) {
      title = readingPosts ? "กำลังโหลดข้อมูลทีม" : showingSample ? "ไม่พบโพสต์ทดสอบ" : "ไม่มีโพสต์ในช่วงที่เลือก";
      message = readingPosts ? "" : "เปลี่ยนช่วงวันที่หรือกด Query 7 วัน เพื่อดึงโพสต์ใหม่";
    } else if (!hasResults) {
      title = "ยังไม่มีผลลัพธ์";
      message = "หลังจากเลือกกลุ่มแล้ว กด Query posts เพื่อดูโพสต์ตัวอย่าง";
    } else if (!rows.length) {
      title = "ไม่พบโพสต์ในช่วงนี้";
      message = isReal ? "เลือกช่วงวันที่กว้างขึ้นหรือเลือกทุกวันที่" : "ลองเพิ่มช่วงเวลาย้อนหลังหรือเลือกกลุ่มอื่น";
    }
    byId("table-content").innerHTML = `<div class="empty"><span class="metric-icon blue" data-icon="list"></span><h3>${title}</h3><p>${message}</p></div>`;
  } else {
    byId("table-content").innerHTML = `<div class="table-scroll" tabindex="0" role="region" aria-label="Query results table"><table aria-label="Query results"><thead><tr>
      <th scope="col">โพสต์ / Post ID</th><th scope="col">กลุ่ม / Group ID</th><th scope="col">${isReal ? "วันที่โพสต์" : "เวลาโพสต์ (ไทย)"}</th><th scope="col">Fix status</th>
    </tr></thead><tbody>${visibleRows.map(resultRow).join("")}</tbody></table></div>`;
  }
  drawIcons(byId("table-content"));
}

function resultRow(post) {
  const key = postKey(post);
  const link = source === "real" ? parsePostLink(post.url) : null;
  const postId = link ? `<a class="post-link" href="${link.url}" target="_blank" rel="noopener noreferrer">Post ID ${post.post_id} ↗</a>` : `Post ID ${post.post_id}`;
  const date = source === "real" && post.source !== "socialapis"
    ? realDateFormat.format(post.created_at) : dateFormat.format(post.created_at);
  return `<tr data-post-key="${key}"><td><strong class="post-message">${escapeText(post.message)}</strong><small>${postId}</small></td>
    <td>${source === "demo" ? groupNames.get(post.group_id) : "Facebook Group"}<small>Group ID ${post.group_id}</small></td>
    <td><time datetime="${new Date(post.created_at).toISOString()}">${date}</time></td>
    <td><select class="status ${post.fix_status}" data-status="${key}" aria-label="Fix status for ${post.group_id} / ${post.post_id}" ${source === "real" && (showingSample || updatingStatus === key) ? "disabled" : ""}>
      <option value="pending" ${post.fix_status === "pending" ? "selected" : ""}>Pending</option>
      <option value="fixed" ${post.fix_status === "fixed" ? "selected" : ""}>Fixed</option>
    </select></td></tr>`;
}

function redrawSetupAndFocus(selector) {
  drawSetup();
  document.querySelector(selector)?.focus();
}

byId("setup").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  switch (button?.id) {
    case "connect-button":
      state.connected = true;
      persist();
      redrawSetupAndFocus("[data-group]");
      announce("เชื่อมต่อบัญชี Facebook จำลองแล้ว");
      break;
    case "toggle-groups":
      state.selected = state.selected.length === groups.length ? [] : groups.map(({ id }) => id);
      persist();
      redrawSetupAndFocus("#toggle-groups");
      break;
    case "query-button": {
      const time = Date.now();
      state.result = { ...runQuery(feed, state.selected, state.days, time), days: state.days, groupIds: [...state.selected], time };
      filter = "all";
      persist();
      redrawSetupAndFocus("#query-button");
      drawResults();
      announce(`พบ ${state.result.keys.length} โพสต์ · ตัดซ้ำ ${state.result.duplicates} รายการ`);
      break;
    }
  }
});

byId("setup").addEventListener("change", (event) => {
  const input = event.target;
  if (input.matches("[data-group]")) {
    const group = input.dataset.group;
    state.selected = input.checked ? [...state.selected, group] : state.selected.filter((id) => id !== group);
    persist();
    redrawSetupAndFocus(`[data-group="${group}"]`);
  } else if (input.id === "lookback") {
    state.days = Number(input.value);
    persist();
    redrawSetupAndFocus("#lookback");
  }
});

byId("table-content").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-status]");
  if (!select) return;
  const key = select.dataset.status;
  const status = select.value;
  if (source === "real") {
    if (showingSample || updatingStatus) {
      drawResults();
      return;
    }
    updatingStatus = key;
    readSequence++;
    readingPosts = false;
    drawResults();
    try {
      const [, post_id] = key.split(":");
      const result = await requestPosts("PATCH", { post_id, fix_status: status });
      for (const post of sharedRows) {
        if (postKey(post) === key) post.fix_status = result.fix_status;
      }
    } catch (error) {
      announce("ยังไม่ได้เปลี่ยนสถานะ · " + error.message);
      return;
    } finally {
      updatingStatus = "";
      drawResults();
    }
  } else {
    state.statuses[key] = status;
    persist();
    drawResults();
  }
  const nextFocus = document.querySelector(`[data-status="${key}"]`) ?? document.querySelector('[data-filter][aria-pressed="true"]');
  nextFocus?.focus({ preventScroll: true });
  announce(status === "fixed" ? "บันทึกสถานะ Fixed แล้ว" : "บันทึกสถานะ Pending แล้ว");
});

document.querySelector(".table-heading .filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  filter = button.dataset.filter;
  drawResults();
});

byId("posts-export-button").addEventListener("click", () => {
  const query = state.lastLiveQuery;
  const rows = query ? latestLiveRows(state.real, query).map((post) => ({
    group_id: post.group_id,
    post_id: post.post_id,
    post_url: post.url,
    published_at: new Date(post.created_at).toISOString(),
    post_text: post.message,
    fix_status: post.fix_status,
  })) : [];
  if (!rows.length) return;

  const payload = {
    schema_version: 1,
    query_at: new Date(query.time).toISOString(),
    partial: Boolean(query.partial),
    sample: Boolean(query.sample),
    posts: rows,
  };
  const file = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = "facebook-group-posts.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  announce(`ดาวน์โหลดผล Query ล่าสุด ${rows.length} โพสต์แล้ว`);
});

function queryToSave() {
  return state.pendingQuery ?? state.legacyQuery;
}

function updateImportButton() {
  const button = byId("posts-retry-button");
  const query = queryToSave();
  button.hidden = !query || latestLiveRows(state.real, query).length === 0;
  button.disabled = querying || savingPosts;
  button.textContent = state.pendingQuery ? "ลองบันทึกผลเดิมอีกครั้ง" : "ย้ายผล Query เดิมเข้าข้อมูลทีม";
}

function showSharedFeedback(message, warning = false) {
  const feedback = byId("shared-feedback");
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.classList.toggle("post-error", warning);
}

async function requestPosts(method, data, params = "") {
  const response = await fetch("/api/posts" + params, {
    method,
    ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "เชื่อมต่อข้อมูลทีมไม่สำเร็จ");
  return result;
}

async function loadSharedPosts(more = false) {
  const requestId = ++readSequence;
  const params = new URLSearchParams({ days: realLookback });
  if (more && nextPage) params.set("before", nextPage);
  if (!more) {
    sharedRows = [];
    nextPage = null;
  }
  readingPosts = true;
  drawResults();
  try {
    const { posts, next } = await requestPosts("GET", null, "?" + params.toString());
    if (requestId !== readSequence) return false;
    sharedRows = more ? [...sharedRows, ...posts] : posts;
    nextPage = next;
    return true;
  } catch {
    if (requestId === readSequence) showSharedFeedback("โหลดข้อมูลทีมไม่สำเร็จ · กดรีเฟรชข้อมูลทีมเพื่อลองใหม่", true);
    return false;
  } finally {
    if (requestId === readSequence) {
      readingPosts = false;
      drawResults();
    }
  }
}

async function saveQueryToTracker(query, importLegacy = false) {
  if (!query || savingPosts || querying) return;
  const posts = latestLiveRows(state.real, query);
  if (!posts.length) return;
  savingPosts = true;
  updateImportButton();
  byId("live-sample-button").disabled = true;
  byId("live-query-button").disabled = true;
  showSharedFeedback(`กำลังบันทึก ${posts.length} โพสต์เข้าข้อมูลทีม`);
  try {
    const { saved } = await requestPosts("POST", { posts, importLegacy });
    if (importLegacy) state.legacyQuery = null;
    else state.pendingQuery = null;
    persist();
    showingSample = false;
    if (await loadSharedPosts()) showSharedFeedback(`บันทึกเข้าข้อมูลทีมแล้ว ${saved} โพสต์`);
  } catch (error) {
    showSharedFeedback(`ยังบันทึกผล Query ไม่สำเร็จ · ${error.message} · ลองบันทึกผลเดิมได้โดยไม่เสียเครดิตเพิ่ม`, true);
  } finally {
    savingPosts = false;
    updateImportButton();
    byId("live-sample-button").disabled = false;
    byId("live-query-button").disabled = !state.mcpVerified;
  }
}

byId("posts-retry-button").addEventListener("click", () => saveQueryToTracker(queryToSave(), !state.pendingQuery));
byId("posts-refresh-button").addEventListener("click", async () => {
  showingSample = false;
  if (await loadSharedPosts() && !savingPosts) showSharedFeedback("");
});
byId("posts-more-button").addEventListener("click", () => loadSharedPosts(true));
document.querySelector("nav").addEventListener("click", (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  document.querySelector("nav .active")?.classList.remove("active");
  link.classList.add("active");
});

function showQueryFeedback(message, warn = false) {
  const feedback = byId("query-feedback");
  feedback.textContent = message;
  feedback.hidden = false;
  feedback.classList.toggle("post-error", warn);
}

async function runLiveQuery(event) {
  event.preventDefault();
  if (querying || savingPosts) return;
  const input = byId("social-key");
  const preview = event.submitter?.id !== "live-query-button" || !state.mcpVerified;
  if (!configured && input.value.trim()) {
    if (runtimeKey !== input.value.trim()) samplePage = null;
    runtimeKey = input.value.trim();
    input.value = "";
    input.placeholder = "ใช้คีย์ที่ใส่ไว้แล้วในแท็บนี้";
  }
  if (!configured && !runtimeKey) {
    showQueryFeedback("วาง API key เพื่อทดสอบ Query", true);
    input.focus();
    return;
  }

  const button = byId("live-query-button");
  const sampleButton = byId("live-sample-button");
  querying = true;
  updateImportButton();
  sampleButton.disabled = true;
  button.disabled = true;
  if (preview) samplePage = null;
  const reuse = !preview && samplePage && Date.now() - samplePage.until < 5 * 60_000 ? samplePage : null;
  const until = reuse?.until ?? Date.now();
  const fetched = new Map(reuse?.page.posts.map((post) => [postKey(post), post]));
  const seen = new Set(reuse?.page.next ? [reuse.page.next] : []);
  const warnings = new Set(reuse?.page.warning ? [reuse.page.warning] : []);
  let cursor = reuse?.page.next ?? null;
  let duplicates = 0;
  let rejected = reuse?.page.rejected ?? 0;
  let pages = reuse ? 1 : 0;
  let credits = reuse?.page.credits ?? null;
  let charged = null;
  let stopped = "";
  try {
    while (!reuse || cursor) {
      showQueryFeedback(`กำลังดึงหน้าที่ ${pages + 1} · พบ ${fetched.size} โพสต์`);
      const response = await fetch("/api/facebook/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ until, cursor, ...(!configured ? { key: runtimeKey } : {}) }),
      });
      const page = await response.json();
      if (!response.ok) throw new Error(page.message ?? "Query ไม่สำเร็จ");
      for (const post of page.posts) {
        const key = postKey(post);
        if (fetched.has(key)) duplicates++;
        fetched.set(key, post);
      }
      rejected += page.rejected;
      if (page.warning) warnings.add(page.warning);
      pages++;
      credits = page.credits ?? credits;
      if (Number.isSafeInteger(page.charged)) charged = (charged ?? 0) + page.charged;
      cursor = page.next;
      if (preview) {
        samplePage = page.posts.length > 0 && !page.warning ? { until, page } : null;
        break;
      }
      if (!cursor) break;
      if (seen.has(cursor)) throw new Error("ผู้ให้บริการส่งหน้าผลลัพธ์ซ้ำ");
      seen.add(cursor);
      if (pages === 30) throw new Error("ถึงขีดจำกัด 30 หน้าต่อการ Query");
    }
  } catch (error) {
    stopped = error instanceof SyntaxError ? "เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ กรุณาเปิด Tracker ใหม่และลองอีกครั้ง" : error.message;
  } finally {
    querying = false;
    updateImportButton();
    sampleButton.disabled = false;
    button.disabled = !state.mcpVerified;
  }

  if (!pages) {
    showQueryFeedback(stopped || "Query ไม่สำเร็จ", true);
    return;
  }
  for (const [key, post] of fetched) {
    state.real[key] = saveRealPost(state.real, post).record;
  }
  const partial = Boolean(stopped || rejected || warnings.size);
  if (fetched.size > 0 && !warnings.size) state.mcpVerified = true;
  button.disabled = !state.mcpVerified;
  state.lastLiveQuery = { time: until, partial, sample: preview, keys: [...fetched.keys()] };
  if (!preview && fetched.size) state.pendingQuery = state.lastLiveQuery;
  showingSample = preview;
  if (!preview) samplePage = null;
  persist();
  filter = "all";
  realLookback = "7";
  byId("real-lookback").value = "7";
  drawResults();
  const summary = [
    partial ? "ได้ผลลัพธ์บางส่วน" : preview ? "ทดสอบหน้าแรกเสร็จแล้ว" : "Query เสร็จแล้ว",
    `พบ ${fetched.size} โพสต์ · ตัดซ้ำ ${duplicates} · อ่าน ${pages} หน้า`,
    rejected ? `${rejected} รายการมี ID หรือวันที่ไม่ครบ` : "",
    [...warnings].slice(0, 2).join(" · "),
    stopped,
    charged === null ? "" : `รอบนี้รายงานใช้ ${charged} เครดิต`,
    credits === null ? "" : `เครดิตคงเหลือ ${credits}`,
    storageAvailable ? "" : "เบราว์เซอร์ไม่อนุญาตให้บันทึกผลข้ามการรีเฟรช",
  ].filter(Boolean);
  showQueryFeedback(summary.join(" · "), partial);
  if (!preview && fetched.size) await saveQueryToTracker(state.lastLiveQuery);
}

byId("live-query-button").disabled = !state.mcpVerified;
byId("live-query").addEventListener("submit", runLiveQuery);

async function checkKeyConfiguration() {
  try {
    const response = await fetch("/api/facebook/status");
    if (!response.ok) return;
    configured = Boolean((await response.json()).configured);
    if (configured) {
      runtimeKey = "";
      byId("social-key").value = "";
      byId("key-field").hidden = true;
      byId("query-hint").textContent = "แสดงผลย้อนหลัง 7 วัน · บันทึกเข้าข้อมูลทีมอัตโนมัติ";
    }
  } catch {
    return;
  }
}

document.querySelector(".source-toggle").addEventListener("click", (event) => {
  const button = event.target.closest("[data-source]");
  if (!button || source === button.dataset.source) return;
  source = button.dataset.source;
  filter = "all";
  document.querySelectorAll("[data-source]").forEach((item) => {
    item.setAttribute("aria-pressed", String(item === button));
  });
  byId("real-workflow").hidden = source !== "real";
  byId("demo-workflow").hidden = source !== "demo";
  drawResults();
});

byId("real-lookback").addEventListener("change", (event) => {
  realLookback = event.target.value;
  showingSample = false;
  loadSharedPosts();
});

drawSetup();
drawResults();
drawIcons();
checkKeyConfiguration();
loadSharedPosts();
