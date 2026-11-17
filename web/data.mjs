const day = 86_400_000;

export const groups = [
  { id: "10001", name: "Broadband Support", detail: "อินเทอร์เน็ตและอุปกรณ์" },
  { id: "10002", name: "Field Operations", detail: "งานช่างและการนัดหมาย" },
  { id: "10003", name: "Service Community", detail: "คำถามและข้อเสนอแนะ" },
];

const samples = [
  ["10001", "501", 0.25, "สัญญาณหลุดช่วงเย็นติดต่อกัน 3 วัน"],
  ["10002", "501", 0.55, "ลูกค้าขอเลื่อนนัดติดตั้งเป็นวันเสาร์"],
  ["10003", "601", 0.8, "ขอวิธีตั้งค่าเราเตอร์หลังเปลี่ยนเครื่อง"],
  ["10001", "502", 1.4, "ไฟ LOS ขึ้นหลังจากไฟดับ"],
  ["10002", "502", 2.2, "ปิดงานแล้ว แต่ระบบยังขึ้นว่ารอดำเนินการ"],
  ["10003", "602", 2.8, "หาเมนูดาวน์โหลดใบเสร็จในแอปไม่เจอ"],
  ["10001", "503", 3.5, "ความเร็ว Wi-Fi ลดลงเมื่ออยู่คนละห้อง"],
  ["10002", "503", 4.4, "ที่อยู่ในใบงานไม่ตรงกับจุดติดตั้ง"],
  ["10003", "603", 5.2, "ขอเพิ่มตัวเลือกเวลาที่สะดวกรับสาย"],
  ["10001", "504", 6.75, "กล้องวงจรปิดเชื่อมต่อไม่ได้หลังเปลี่ยนรหัส Wi-Fi"],
  ["10002", "504", 9, "ตรวจสอบสถานะคำขอย้ายจุดติดตั้ง"],
  ["10003", "604", 12, "ขอคู่มือการเปลี่ยนแพ็กเกจออนไลน์"],
  ["10001", "505", 21, "ถามเรื่องพื้นที่ให้บริการในอาคารใหม่"],
];

export const postKey = ({ group_id, post_id }) => group_id + ":" + post_id;

export function makeFeed(anchor) {
  const posts = samples.map(([group_id, post_id, age, message]) => ({
    group_id, post_id, message, created_at: anchor - age * day,
  }));
  return [...posts, { ...posts[0] }, { ...posts[2] }, { ...posts[4] }];
}

export function runQuery(feed, groupIds, days, now) {
  const selected = new Set(groupIds);
  const unique = new Map();
  let duplicates = 0;
  for (const post of feed) {
    if (!selected.has(post.group_id) || post.created_at < now - days * day || post.created_at > now) continue;
    const key = postKey(post);
    if (unique.has(key)) {
      duplicates++;
    } else {
      unique.set(key, post);
    }
  }
  return { keys: [...unique.values()].sort((left, right) => right.created_at - left.created_at).map(postKey), duplicates };
}

export function parsePostLink(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const link = /^\/groups\/(\d+)\/(?:posts|permalink)\/(\d+)\/?$/.exec(url.pathname);
  if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.host) ||
      url.username || url.password || !link) return null;
  const [, group_id, post_id] = link;
  return { group_id, post_id, url: `https://www.facebook.com/groups/${group_id}/posts/${post_id}/` };
}

export function realPostsInRange(posts, days, now = Date.now()) {
  const firstDay = days === "all" ? -Infinity : now - Number(days) * day;
  return posts.filter((post) => post.created_at >= firstDay).sort((left, right) => right.created_at - left.created_at);
}

export function saveRealPost(posts, post) {
  const key = postKey(post);
  const exists = Object.hasOwn(posts, key);
  return { key, exists, record: { ...post, fix_status: posts[key]?.fix_status ?? "pending" } };
}


export function latestLiveRows(saved, query) {
  const until = query.time;
  const from = until - 7 * day;
  const rows = Array.isArray(query.keys) ? query.keys.map((key) => saved[key]) : Object.values(saved);
  return rows.filter((row) => row && row.created_at >= from && row.created_at <= until)
    .sort((left, right) => right.created_at - left.created_at);
}
