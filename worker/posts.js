const validPostId = (id) => typeof id === "string" && /^\d{1,30}$/.test(id);
const validStatus = (status) => status === "fixed" || status === "pending";
const maxPostsPerPage = 100;

async function readSharedPosts(request, db) {
  const params = new URL(request.url).searchParams;
  const days = params.get("days") ?? "7";
  if (!["7", "14", "30", "all"].includes(days)) return failure("ช่วงวันที่ไม่ถูกต้อง", 400);
  const minTime = days === "all" ? 0 : Date.now() - Number(days) * dayMs;
  const rawCursor = params.get("before");
  const cursor = rawCursor?.split(":");
  if (cursor && (cursor.length !== 2 || !/^\d{1,15}$/.test(cursor[0]) || !validPostId(cursor[1]))) {
    return failure("หน้าผลลัพธ์ไม่ถูกต้อง", 400);
  }
  const whereCursor = cursor ? "AND (created_at < ? OR (created_at = ? AND post_id < ?))" : "";
  const bindings = cursor ? [minTime, Number(cursor[0]), Number(cursor[0]), cursor[1]] : [minTime];
  const { results } = await db.prepare(`
    SELECT group_id, post_id, created_at, message, fix_status FROM facebook_posts
    WHERE created_at >= ? ${whereCursor}
    ORDER BY created_at DESC, post_id DESC LIMIT ?
  `).bind(...bindings, maxPostsPerPage + 1).all();
  const page = results.slice(0, maxPostsPerPage);
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

async function sharedPostsApi(request, env) {
  if (!request.headers.get("oai-authenticated-user-id")) return failure("กรุณาเข้าสู่ระบบ Tracker", 401);
  if (!env.DB) return failure("ยังเชื่อมต่อฐานข้อมูลของ Tracker ไม่ได้", 503);
  try {
    if (request.method === "GET") return await readSharedPosts(request, env.DB);
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
    return request.method === "POST" ? await saveSharedPosts(data, env.DB) : await changeSharedStatus(data, env.DB);
  } catch (error) {
    console.error("tracker_database_request_failed", { method: request.method, message: error?.name });
    return failure("ฐานข้อมูลของ Tracker ตอบกลับไม่สำเร็จ", 503);
  }
}
