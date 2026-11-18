const topics = ["appointment_install", "repair_quality", "service_fault", "billing_plan", "general", "unclear"];
const concerns = ["yes", "review", "no"];
const maxAnalysisBatch = 6;

// Older automatic suggestions are derived from the post text and can be corrected
// when the scope check finds a mismatch. Confirmed values are user-owned.
async function repairScopedSuggestions(db, posts) {
  const writes = [];
  for (const post of posts) {
    const modelTopic = post.topic_source === "model" ? post.topic : null;
    const modelConcern = post.concern_source === "model" ? post.technician_concern : null;
    if (!modelTopic && !modelConcern) continue;
    const decision = scopeCorrection(post.message, modelTopic, modelConcern);
    if (!decision) continue;
    if (modelTopic && modelTopic !== decision.topic &&
        (decision.topic === "general" || modelTopic === "repair_quality" || modelTopic === "appointment_install")) {
      writes.push(db.prepare(`
        UPDATE facebook_post_topics SET topic = ?, evidence = ?
        WHERE group_id = ? AND post_id = ? AND source = 'model' AND analyzed_message = ? AND topic = ?
      `).bind(decision.topic, decision.evidence, post.group_id, post.post_id, post.message, modelTopic));
      Object.assign(post, { topic: decision.topic, topic_evidence: decision.evidence });
    }
    if (modelConcern && modelConcern !== decision.concern) {
      writes.push(db.prepare(`
        UPDATE facebook_post_concerns SET technician_concern = ?, evidence = ?
        WHERE group_id = ? AND post_id = ? AND source = 'model' AND analyzed_message = ? AND technician_concern = ?
      `).bind(decision.concern, decision.evidence, post.group_id, post.post_id, post.message, modelConcern));
      Object.assign(post, { technician_concern: decision.concern, concern_evidence: decision.evidence });
    }
  }
  if (writes.length) await db.batch(writes);
}
async function analyzeSharedPosts(data, env) {
  const ids = data?.post_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > maxAnalysisBatch ||
      ids.some((id) => !validPostId(id)) || new Set(ids).size !== ids.length) {
    return failure("รหัสโพสต์สำหรับวิเคราะห์ไม่ถูกต้อง", 400);
  }
  const { results: candidates } = await env.DB.prepare(`
    SELECT p.post_id, p.message FROM facebook_posts p LEFT JOIN facebook_post_topics t
      ON t.group_id = p.group_id AND t.post_id = p.post_id
      AND (t.source = 'manual' OR t.analyzed_message = p.message)
    WHERE p.group_id = ? AND p.post_id IN (${ids.map(() => "?").join(", ")}) AND t.post_id IS NULL
  `).bind(groupId, ...ids).all();
  const classified = candidates.map((post) => ({ post, ...classifyTopic(post.message) }));
  const statements = classified.flatMap(({ post, topic, concern, evidence }) => [
    topicStatement(env.DB, { post_id: post.post_id, topic, source: "model", evidence, message: post.message }),
    concernStatement(env.DB, { post_id: post.post_id, technician_concern: concern, concern_source: "model",
      concern_evidence: evidence, analyzed_message: post.message }),
  ]);
  const writes = statements.length ? await env.DB.batch(statements) : [];
  const updates = classified.flatMap(({ post, topic, concern, evidence }, index) => {
    if (!writes[index * 2]?.meta.changes) return [];
    const work = writes[index * 2 + 1]?.meta.changes
      ? { technician_concern: concern, concern_source: "model", concern_evidence: evidence } : {};
    return [{ post_id: post.post_id, topic, topic_source: "model", topic_evidence: evidence, ...work }];
  });
  return json({ updates, skipped: ids.length - updates.length });
}

function topicStatement(db, { post_id, topic, source, evidence = "", message = null }) {
  return db.prepare(`
    INSERT INTO facebook_post_topics (group_id, post_id, topic, source, evidence, analyzed_message)
    SELECT group_id, post_id, ?, ?, ?, ? FROM facebook_posts
    WHERE group_id = ? AND post_id = ? AND (? = 'manual' OR message = ?)
    ON CONFLICT (group_id, post_id) DO UPDATE SET
      topic = excluded.topic, source = excluded.source, evidence = excluded.evidence,
      analyzed_message = excluded.analyzed_message
    WHERE excluded.source = 'manual' OR
      (facebook_post_topics.source <> 'manual' AND facebook_post_topics.analyzed_message <> excluded.analyzed_message)
  `).bind(topic, source, evidence, message, groupId, post_id, source, message);
}

async function changeSharedTopic(data, db) {
  const { post_id, topic } = data;
  if (!validPostId(post_id) || !topics.includes(topic)) return failure("หัวข้อโพสต์ไม่ถูกต้อง", 400);
  const { meta } = await topicStatement(db, { post_id, topic, source: "manual" }).run();
  return meta.changes ? json({ topic, topic_source: "manual", topic_evidence: "" }) : failure("ไม่พบโพสต์นี้แล้ว", 404);
}
