const validPostId = (id) => typeof id === "string" && /^\d{1,30}$/.test(id);
const validStatus = (status) => status === "fixed" || status === "pending";
const maxPostsPerPage = 100;

async function readSharedPosts(request, env) {
  const db = env.DB;
  const params = new URL(request.url).searchParams;
  const days = params.get("days") ?? "7";
  if (!["7", "14", "30", "all"].includes(days)) return failure("ช่วงวันที่ไม่ถูกต้อง", 400);
  const minTime = days === "all" ? 0 : Date.now() - Number(days) * dayMs;
  const rawCursor = params.get("before");
  const cursor = rawCursor?.split(":");
  if (cursor && (cursor.length !== 2 || !/^\d{1,15}$/.test(cursor[0]) || !validPostId(cursor[1]))) {
    return failure("หน้าผลลัพธ์ไม่ถูกต้อง", 400);
  }
  const whereCursor = cursor ? "AND (p.created_at < ? OR (p.created_at = ? AND p.post_id < ?))" : "";
  const bindings = cursor ? [minTime, Number(cursor[0]), Number(cursor[0]), cursor[1]] : [minTime];
  const { results } = await db.prepare(`
    SELECT p.group_id, p.post_id, p.created_at, p.message, p.fix_status,
           c.technician_concern, c.source AS concern_source, c.evidence AS concern_evidence,
           t.topic, t.source AS topic_source, t.evidence AS topic_evidence,
           f.decision AS follow_up, f.source AS follow_up_source, f.reason AS follow_up_reason,
           f.evidence AS follow_up_evidence
    FROM facebook_posts AS p LEFT JOIN facebook_post_concerns AS c
      ON c.group_id = p.group_id AND c.post_id = p.post_id
      AND (c.source = 'manual' OR c.analyzed_message = p.message)
    LEFT JOIN facebook_post_topics AS t ON t.group_id = p.group_id AND t.post_id = p.post_id
      AND (t.source = 'manual' OR t.analyzed_message = p.message)
    LEFT JOIN facebook_post_followups AS f ON f.group_id = p.group_id AND f.post_id = p.post_id
      AND (f.source = 'manual' OR f.analyzed_message = p.message)
    WHERE p.created_at >= ? ${whereCursor}
    ORDER BY p.created_at DESC, p.post_id DESC LIMIT ?
  `).bind(...bindings, maxPostsPerPage + 1).all();
  const page = results.slice(0, maxPostsPerPage);
  await repairScopedSuggestions(db, page);
  const last = page.at(-1);
  return json({
    posts: page.map((post) => ({ ...post, url: groupUrl + "/posts/" + post.post_id + "/" })),
    next: results.length > maxPostsPerPage ? last.created_at + ":" + last.post_id : null,
  });
}

async function saveSharedPosts(data, db) {
  const { posts, importLegacy = false } = data ?? {};
  if (typeof importLegacy !== "boolean" || !Array.isArray(posts) || !posts.length || posts.length > 90 ||
      !posts.every((post) => post?.group_id === groupId && validPostId(post.post_id) &&
        Number.isSafeInteger(post.created_at) && post.created_at > 0 && post.created_at <= Date.now() + 60000 &&
        typeof post.message === "string" && post.message.length <= 6000 && validStatus(post.fix_status))) {
    return failure("ข้อมูลโพสต์สำหรับบันทึกไม่ถูกต้อง", 400);
  }
  const unique = new Map(posts.map((post) => [post.post_id, post]));
  const insert = db.prepare(`
    INSERT INTO facebook_posts (group_id, post_id, created_at, message, fix_status)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (group_id, post_id) DO UPDATE SET
      created_at = CASE WHEN ? = 1 THEN facebook_posts.created_at ELSE excluded.created_at END,
      message = CASE WHEN ? = 1 THEN facebook_posts.message ELSE excluded.message END,
      fix_status = CASE
        WHEN ? = 1 AND facebook_posts.status_updated_at IS NULL AND excluded.fix_status = 'fixed' THEN 'fixed'
        ELSE facebook_posts.fix_status
      END
  `);
  const importing = Number(importLegacy);
  await db.batch([...unique.values()].map((post) => insert.bind(
    groupId, post.post_id, post.created_at, post.message, importLegacy ? post.fix_status : "pending",
    importing, importing, importing,
  )));
  return json({ saved: unique.size });
}

async function changeSharedStatus(data, db) {
  const { post_id, fix_status } = data ?? {};
  if (!validPostId(post_id) || !validStatus(fix_status)) return failure("สถานะโพสต์ไม่ถูกต้อง", 400);
  const { meta } = await db.prepare("UPDATE facebook_posts SET fix_status = ?, status_updated_at = ? WHERE group_id = ? AND post_id = ?")
    .bind(fix_status, Date.now(), groupId, post_id).run();
  if (!meta.changes) return failure("ไม่พบโพสต์นี้ใน Tracker", 404);
  return json({ fix_status });
}

async function changeSharedConcern(data, db) {
  const { post_id, technician_concern, concern_source, concern_evidence = "", analyzed_message } = data;
  const model = concern_source === "model";
  if (!validPostId(post_id) || !["yes", "review", "no"].includes(technician_concern) ||
      (!model && concern_source !== "manual") || typeof concern_evidence !== "string" ||
      (model && (typeof analyzed_message !== "string" || analyzed_message.length > 6000 ||
        (concern_evidence && !analyzed_message.includes(concern_evidence)) ||
        (technician_concern === "yes" && !concern_evidence))) ||
      (!model && concern_evidence !== "")) {
    return failure("ข้อมูลการจัดหมวดไม่ถูกต้อง", 400);
  }
  const { meta } = await concernStatement(db, data).run();
  if (!meta.changes) return failure("โพสต์หรือหมวดเปลี่ยนไปแล้ว · กรุณารีเฟรชข้อมูลทีม", 409);
  return json({ technician_concern, concern_source, concern_evidence });
}

function concernStatement(db, { post_id, technician_concern, concern_source, concern_evidence = "", analyzed_message }) {
  const model = concern_source === "model";
  return db.prepare(`
    INSERT INTO facebook_post_concerns
      (group_id, post_id, technician_concern, source, evidence, analyzed_message)
    SELECT group_id, post_id, ?, ?, ?, ? FROM facebook_posts
    WHERE group_id = ? AND post_id = ? AND (? = 'manual' OR message = ?)
    ON CONFLICT (group_id, post_id) DO UPDATE SET
      technician_concern = excluded.technician_concern, source = excluded.source,
      evidence = excluded.evidence, analyzed_message = excluded.analyzed_message
    WHERE excluded.source = 'manual' OR facebook_post_concerns.source <> 'manual'
  `).bind(technician_concern, concern_source, concern_evidence, model ? analyzed_message : null,
    groupId, post_id, concern_source, model ? analyzed_message : null);
}

async function sharedPostsApi(request, env) {
  if (!request.headers.get("oai-authenticated-user-id")) return failure("กรุณาเข้าสู่ระบบ Tracker", 401);
  if (!env.DB) return failure("ยังเชื่อมต่อฐานข้อมูลของ Tracker ไม่ได้", 503);
  try {
    if (request.method === "GET") return await readSharedPosts(request, env);
    if (!["POST", "PATCH"].includes(request.method)) return failure("รูปแบบคำขอไม่ถูกต้อง", 405);
    if (request.headers.get("Origin") !== new URL(request.url).origin) return failure("คำขอนี้ต้องมาจากหน้า Tracker", 403);
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) return failure("รูปแบบคำขอไม่ถูกต้อง", 415);
    let data;
    try {
      const raw = await request.text();
      if (raw.length > 1200000) return failure("ข้อมูลยาวเกินกำหนด", 413);
      data = JSON.parse(raw);
    } catch {
      return failure("รูปแบบคำขอไม่ถูกต้อง", 400);
    }
    if (request.method === "POST") {
      if (data?.action === "analyze_followups") return await analyzeFollowups(data, env);
      return data?.action === "analyze" ? await analyzeSharedPosts(data, env) : await saveSharedPosts(data, env.DB);
    }
    if (data && Object.hasOwn(data, "follow_up")) return await changeFollowup(data, env.DB);
    if (data && Object.hasOwn(data, "topic")) return await changeSharedTopic(data, env.DB);
    return data && Object.hasOwn(data, "technician_concern")
      ? await changeSharedConcern(data, env.DB)
      : await changeSharedStatus(data, env.DB);
  } catch (error) {
    console.error("tracker_database_request_failed", { method: request.method, message: error?.name });
    return failure("ฐานข้อมูลของ Tracker ตอบกลับไม่สำเร็จ", 503);
  }
}
