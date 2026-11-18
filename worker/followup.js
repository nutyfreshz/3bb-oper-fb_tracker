const followupBatchSize = 6;
const missedVisit = /(?:ช่าง|ทีมซ่อม|ทีมติดตั้ง)[^!?\n]{0,48}(?:ยังไม่(?:มา|เข้า|ยอมมา)|ไม่(?:ยอม)?มา|ไม่มาตามนัด|ไม่เข้าตามนัด|มาไม่ได้|ขอเลื่อน)|(?:เลย|ผิด|พลาด)นัด|(?:เลยเวลา|เลยวัน|พ้นเวลา)[^.!?\n]{0,15}นัด|นัดแล้ว[^.!?\n]{0,35}(?:ไม่มา|ไม่มีใครมา)|ไม่มีวี่แวว(?:ของ)?(?:ช่าง|ทีมซ่อม|ทีมติดตั้ง)/gu;
const caseReference = /แจ้ง(?:ซ่อม|เสีย|ปัญหา)(?:[^.!?\n]{0,20})(?:แล้ว|ไป|ตั้งแต่|กับ|ผ่าน)|โทร(?:แจ้ง|หา|ไป)[^.!?\n]{0,30}(?:ศูนย์|1530|ซ่อม|เสีย|call\s*center)|(?:เลข|เปิด|รับ|ปิด)(?:ใบงาน|เคส|ทิคเก็ต|ตั๋วงาน)|เลขรับเรื่อง|\bticket\b|แจ้ง(?:ศูนย์|1530|ais|3bb)|นัด(?:หมาย)?\s*ช่าง|นัด(?:เข้า)?(?:ติดตั้ง|ย้ายจุด)(?:ไว้|แล้ว|วัน)|(?:ใบงาน|เคส|งานซ่อม)ปิด|ช่าง[^.!?\n]{0,18}(?:นัด|โทรมา)|ตามช่าง|รอช่าง|(?:ย้าย(?:จุด|บ้าน|ที่อยู่)|สมัคร)[^.!?\n]{0,35}(?:รับเรื่อง|นัด|รอคิว)/iu;
const fieldVisit = /(?:ช่าง|ทีมซ่อม|ทีมติดตั้ง|เจ้าหน้าที่)[^.!?\n]{0,28}(?:มา(?:ดู|แก้|เช็ก|เช็ค|ซ่อม|เปลี่ยน|ติดตั้ง|แล้ว)|กลับไป|เข้ามา|เดินสาย|เปลี่ยน(?:กล่อง|สาย|เราเตอร์|router))|หลัง(?:ซ่อม|ติดตั้ง|เปลี่ยน)|ปิด(?:ใบงาน|เคส|งานซ่อม)|(?:ใบงาน|เคส|งานซ่อม)ปิด/iu;
const ongoing = /ยัง(?:ไม่หาย|ไม่(?:ได้)?แก้|ใช้งานไม่ได้|ใช้ไม่ได้|หลุด|ค้าง|เป็น(?:อยู่|เหมือนเดิม)|เงียบ|ไม่มีใคร(?:โทร|ติดต่อ|แจ้ง))|(?:กลับมา|มา)เป็นอีก|แก้(?:แล้ว)?ไม่หาย|(?:อาการ|ปัญหา|ยัง|ก็)เหมือนเดิม|ไม่ได้รับการแก้ไข|(?:เรื่อง|งาน|เคส)(?:ยัง)?ค้าง|(?:ความเร็ว|สัญญาณ)(?:ยัง)?(?:ลดลง|ตก|ช้าลง)|สัญญาณ(?:ไม่ถึง|ไปไม่ถึง)|(?:เน็ต|ความเร็ว)[^.!?\n]{0,7}เหลือแค่นี้|ระยะ[^.!?\n]{0,12}ไม่ถึง|(?:อาการ|ปัญหา)(?:เป็นซ้ำ|ถี่ขึ้น|ถี่มาก)/gu;
const waited = /(?:รอ|ผ่านมา|ผ่านไป|เสียมา|แจ้งมา)[^.!?\n]{0,25}(?:\d+\s*(?:วัน|สัปดาห์)|หลายวัน|ทั้งวัน|ข้ามวัน|ตั้งแต่(?:เช้า|เมื่อวาน)|อาทิตย์|สัปดาห์)|(?:เงียบหาย|(?:ยัง)?ไม่มี(?:คน|ใคร)(?:โทร|ติดต่อ|แจ้ง)|ไม่มีการติดต่อกลับ)|ได้คิวช้ากว่า/iu;
const resolved = /(?:กลับมา)?(?:ใช้งาน|ใช้เน็ต|เล่นเน็ต|เข้าเน็ต)(?:ได้|ปกติ)แล้ว|(?:อาการ|เน็ต)หายแล้ว|(?:ตอนนี้|เรียบร้อยแล้ว)[^.!?\n]{0,14}(?:หายแล้ว|ใช้ได้|ปกติแล้ว)|แก้(?:ปัญหา)?(?:จบ|เรียบร้อย)แล้ว|หายเป็นปกติแล้ว/gu;
const fault = /(?:เน็ต|อินเทอร์เน็ต|ไวไฟ|wi-?fi|สัญญาณ)[^.!?\n]{0,20}(?:ไม่มา|ใช้ไม่ได้|ใช้งานไม่ได้|เสีย|ล่ม|หลุด|ช้า|ดับ|ไม่ขึ้น)|(?:ไฟ|สัญญาณ)\s*(?:los|pon)[^.!?\n]{0,12}(?:แดง|กระพริบ)|สาย(?:ไฟเบอร์|เน็ต)[^.!?\n]{0,8}(?:ขาด|หลุด)|แจ้ง(?:ซ่อม|เสีย)|ใช้งานไม่ได้|(?:เล่น|เชื่อม)[^.!?\n]{0,22}ไม่ได้(?:เลย|ทั้งวัน)|โหลดบัฟเฟอร์|ไวไฟ[^.!?\n]{0,32}ดู[^.!?\n]{0,20}ไม่ได้/iu;

function lastFollowupMatch(text, pattern) {
  if (!pattern.global) return pattern.exec(text);
  let last = null;
  for (const match of text.matchAll(pattern)) last = match;
  return last;
}

function classifyFollowup(message) {
  const text = message.normalize("NFKC").replace(/https?:\/\/\S+/gu, " ");
  if (!text.trim() || message === "โพสต์มีสื่อประกอบ · เปิดลิงก์เพื่อดู") {
    return { decision: "review", reason: "ข้อความไม่พอจะตรวจว่ามีเคสค้าง", evidence: "" };
  }
  const missed = lastFollowupMatch(text, missedVisit);
  const activeIssue = lastFollowupMatch(text, ongoing);
  const completed = lastFollowupMatch(text, resolved);
  const gap = lastFollowupMatch(text, waited);
  const hasReference = caseReference.test(text);
  const hasVisit = fieldVisit.test(text);
  const hasFault = fault.test(text);
  const late = hasReference ? missed ?? gap : missed && /ช่าง|ทีมซ่อม|ทีมติดตั้ง|นัด/u.test(missed[0]) ? missed : null;
  const openIssue = activeIssue && (hasVisit || hasReference) ? activeIssue : null;
  const anchor = [late, openIssue].filter(Boolean).sort((a,b) => b.index - a.index)[0];

  function result(decision, reason, match = null) {
    const key = match?.[0]?.trim();
    const segments = message.split(/[\n.!?]+/u);
    const excerpt = key ? segments.find((part) => part.normalize("NFKC").includes(key)) : null;
    const start = excerpt && key ? Math.max(0, excerpt.normalize("NFKC").indexOf(key) - 60) : 0;
    return { decision, reason, evidence: excerpt ? excerpt.slice(start, start + 200).trim() : "" };
  }

  if (scopeCorrection(message, null, null)?.topic === "general" && !anchor) {
    return result("no", "ข่าวหรือบทความทั่วไป");
  }
  if (completed && (!anchor || completed.index > anchor.index)) {
    return result("no", "โพสต์แจ้งว่าบริการกลับมาใช้ได้", completed);
  }
  if (anchor) return result("yes", anchor === late
    ? "มีงานที่แจ้งหรือนัดแล้ว แต่ล่าช้าหรือยังไม่มีคนเข้าดำเนินการ"
    : "มีการแจ้งหรือเข้าซ่อมแล้ว แต่อาการยังอยู่", anchor);
  if (hasFault) return result("review", "พบปัญหาบริการ แต่ยังไม่ชัดว่ามีเคสที่ค้างให้ตาม", lastFollowupMatch(text, fault));
  return result("no", "โพสต์ไม่ได้ระบุงานค้างที่หลังบ้านต้องเร่งตาม");
}

function followupStatement(db, { post_id, decision, source, reason = "", evidence = "", message = null }) {
  return db.prepare(`
    INSERT INTO facebook_post_followups (group_id, post_id, decision, source, reason, evidence, analyzed_message)
    SELECT group_id, post_id, ?, ?, ?, ?, ? FROM facebook_posts
    WHERE group_id = ? AND post_id = ? AND (? = 'manual' OR message = ?)
    ON CONFLICT (group_id, post_id) DO UPDATE SET
      decision = excluded.decision, source = excluded.source, reason = excluded.reason,
      evidence = excluded.evidence, analyzed_message = excluded.analyzed_message
    WHERE excluded.source = 'manual' OR
      (facebook_post_followups.source = 'model' AND facebook_post_followups.analyzed_message <> excluded.analyzed_message)
  `).bind(decision, source, reason, evidence, message, groupId, post_id, source, message);
}

async function analyzeFollowups(data, env) {
  const ids = data?.post_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > followupBatchSize ||
      ids.some((id) => !validPostId(id)) || new Set(ids).size !== ids.length) {
    return failure("รหัสโพสต์สำหรับประเมินไม่ถูกต้อง", 400);
  }
  const { results } = await env.DB.prepare(`
    SELECT p.post_id, p.message FROM facebook_posts p LEFT JOIN facebook_post_followups f
      ON f.group_id = p.group_id AND f.post_id = p.post_id
      AND (f.source = 'manual' OR f.analyzed_message = p.message)
    WHERE p.group_id = ? AND p.post_id IN (${ids.map(() => "?").join(", ")}) AND f.post_id IS NULL
  `).bind(groupId, ...ids).all();
  const decisions = results.map((post) => ({ post_id: post.post_id, message: post.message, ...classifyFollowup(post.message) }));
  const writes = decisions.length ? await env.DB.batch(decisions.map((value) =>
    followupStatement(env.DB, { ...value, source: "model" }))) : [];
  const updates = decisions.flatMap(({ post_id, decision, reason, evidence }, index) => writes[index]?.meta.changes
    ? [{ post_id, follow_up: decision, follow_up_source: "model", follow_up_reason: reason, follow_up_evidence: evidence }]
    : []);
  return json({ updates, skipped: ids.length - updates.length });
}

async function changeFollowup(data, db) {
  const { post_id, follow_up } = data;
  if (!validPostId(post_id) || !["yes", "no"].includes(follow_up)) return failure("สถานะการติดตามไม่ถูกต้อง", 400);
  const { meta } = await followupStatement(db, { post_id, decision: follow_up, source: "manual" }).run();
  return meta.changes
    ? json({ follow_up, follow_up_source: "manual", follow_up_reason: "", follow_up_evidence: "" })
    : failure("ไม่พบโพสต์นี้แล้ว", 404);
}
