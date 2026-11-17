import { readFile, writeFile } from "node:fs/promises";

const [output, ...inputs] = process.argv.slice(2);
if (!output?.endsWith(".sql") || !inputs.length) {
  throw new Error("Usage: npm run prepare:migration -- tracker-posts-migration.sql page-1.json [page-2.json ...]");
}

const groupId = "180446535798602";
const unique = new Map();
let expectedCursor = null;
for (const path of inputs) {
  const page = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(page.posts) || page.next !== null && typeof page.next !== "string") {
    throw new Error("The input must be a raw JSON page from the source Tracker posts API.");
  }
  if (unique.size > 0 && expectedCursor === null) throw new Error("Unexpected page after the last page.");
  for (const row of page.posts) {
    if (row.group_id !== groupId || typeof row.post_id !== "string" || !/^\d{1,30}$/.test(row.post_id) ||
        !Number.isSafeInteger(row.created_at) || row.created_at <= 0 || typeof row.message !== "string" ||
        row.message.length > 6000 || row.message.includes("\0") || !["pending", "fixed"].includes(row.fix_status)) {
      throw new Error("The source includes an invalid post.");
    }
    if (unique.has(row.post_id)) throw new Error("Duplicate post in source pages. Export a fresh complete set.");
    unique.set(row.post_id, row);
  }
  expectedCursor = page.next;
}
if (expectedCursor !== null) throw new Error("The source export has additional pages. Supply every page.");
if (!unique.size) throw new Error("The source export contains no posts.");

const quoted = (value) => "'" + value.replaceAll("'", "''") + "'";
const tuples = [...unique.values()].map((row) => [
  quoted(row.group_id), quoted(row.post_id), row.created_at, quoted(row.message), quoted(row.fix_status),
].join(", "));
const sql = [
  "BEGIN;",
  "SET LOCAL standard_conforming_strings = on;",
  "INSERT INTO facebook_posts (group_id, post_id, created_at, message, fix_status)",
  "VALUES",
  tuples.map((tuple) => "(" + tuple + ")").join(",\n"),
  "ON CONFLICT (group_id, post_id) DO NOTHING;",
  "COMMIT;",
  "",
].join("\n");
await writeFile(output, sql, { flag: "wx", mode: 0o600 });
console.log(`Prepared ${unique.size} posts, including ${[...unique.values()].filter((row) => row.fix_status === "fixed").length} Fixed.`);
