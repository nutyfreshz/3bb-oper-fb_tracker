import { mkdir, readFile, writeFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const assets = {};
for (const [name, type] of Object.entries({
  "index.html": "text/html", "styles.css": "text/css",
  "app.js": "text/javascript", "data.mjs": "text/javascript",
})) {
  assets["/" + name] = { type: type + "; charset=utf-8", body: await read("../web/" + name) };
}
await mkdir("dist/server", { recursive: true });
await writeFile(
  "dist/server/index.js",
  "const siteAssets = " + JSON.stringify(assets) + ";\n" +
    await read("../worker/index.js") + "\n" + await read("../worker/posts.js"),
);
