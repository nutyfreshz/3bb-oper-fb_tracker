const topicBuckets = 8192;
const topicContent = /[^\p{L}\p{M}\p{N}]/gu;

function compactTopicFeatures(message) {
  const chars = Array.from(message.normalize("NFKC").toLowerCase().replace(topicContent, "")).slice(0, 1200);
  const buckets = new Map();
  for (let start = 0; start < chars.length; start++) {
    let hash = 2166136261;
    for (let end = start; end < Math.min(start + 5, chars.length); end++) {
      hash = Math.imul(hash ^ chars[end].codePointAt(0), 16777619);
      if (end > start) buckets.set(hash & (topicBuckets - 1), hash < 0 ? 1 : -1);
    }
  }
  return buckets;
}

function topicScores(message) {
  const features = compactTopicFeatures(message);
  const factor = 1 / (1024 * Math.sqrt(Math.max(features.size, 1)));
  const scores = topicWeights.weights.map((weights, index) => {
    let score = 0;
    for (const [slot, sign] of features) score += (weights[slot] ?? 0) * sign;
    return { topic: topicWeights.labels[index], score: topicWeights.bias[index] + score * factor };
  });
  return scores.sort((left, right) => right.score - left.score);
}

const productAnnouncement = /เปิดตัว|เผยโฉม|เปิดราคา|เปิดจำหน่าย|วางจำหน่าย|อัปเดต(?:ระบบปฏิบัติการ|ซอฟต์แวร์)/iu;
const consumerProduct = /ระบบปฏิบัติการ|ซอฟต์แวร์|สมาร์ตโฟน|สมาร์ทโฟน|มือถือ|แท็บเล็ต|หูฟัง|coloros|android|iphone|galaxy\s+tab/iu;
const fieldAction = /(?:ช่าง|ทีมติดตั้ง|ทีมซ่อม|เจ้าหน้าที่หน้างาน)[\s\S]{0,28}(?:ยังไม่เข้า|ไม่มา|โทร|เข้ามา|มา(?:ดู|เช็ก|เช็ค|ซ่อม|แก้|เปลี่ยน)|นัด|เลื่อน|คิว|เดินสาย|ลงพื้นที่|บอกว่า)|(?:นัด(?:หมาย)?|ตาม|รอ|ติดต่อ|คิว)\s*ช่าง|พนักงาน[\s\S]{0,18}นัด|(?:เจ้าหน้าที่|พนักงาน)[\s\S]{0,20}(?:เดินสาย|เข้ามา|ลงพื้นที่)|(?:นัด|รอ)\s*(?:เข้า)?(?:ติดตั้ง|ย้ายจุด|ย้ายที่ติดตั้ง)[\s\S]{0,30}(?:ไว้|แล้ว|มา|เมื่อ|บ่าย|เช้า|โมง|คิว|วัน[จอพศส])/u;

function scopeCorrection(message, topic, concern) {
  const text = message.normalize("NFKC").replace(/https?:\/\/[^\s)]+/gu, " ").replace(/#[^\s]+/gu, " ");
  const title = text.slice(0, 200);
  const hasFieldAction = fieldAction.test(text);
  if (!hasFieldAction && productAnnouncement.test(title) && consumerProduct.test(title)) {
    return { topic: "general", concern: "no", evidence: message.trim().slice(0, 160) };
  }
  if (!hasFieldAction && (concern === "yes" || topic === "repair_quality" || topic === "appointment_install")) {
    return { topic: "unclear", concern: "review", evidence: "" };
  }
  return null;
}

function classifyTopic(message) {
  if (message === "โพสต์มีสื่อประกอบ · เปิดลิงก์เพื่อดู" || !message.trim()) {
    return { topic: "unclear", concern: "review", evidence: "" };
  }
  const [best] = topicScores(message);
  const { topic } = best;
  const concern = topic === "appointment_install" || topic === "repair_quality" ? "yes"
    : topic === "billing_plan" || topic === "general" ? "no" : "review";
  const scoped = scopeCorrection(message, topic, concern);
  if (scoped) return scoped;
  let evidence = "";
  let bestPassage = 0;
  if (topic !== "unclear") {
    const passages = message.slice(0, 2000).match(/[^\n.!?]+[.!?]?/gu) ?? [];
    for (const text of passages.slice(0, 8)) {
      const excerpt = text.trim().slice(0, 200);
      if (excerpt.length < 8) continue;
      const [first, second] = topicScores(excerpt);
      const margin = first.score - second.score;
      if (first.topic === topic && margin > bestPassage) {
        evidence = excerpt;
        bestPassage = margin;
      }
    }
  }
  // The existing concern API requires exact evidence before proposing field work.
  if (concern === "yes" && !evidence) evidence = message.trim().slice(0, 200);
  return { topic, concern, evidence };
}
