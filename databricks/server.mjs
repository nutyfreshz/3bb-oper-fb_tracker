import { createServer } from "node:http";
import worker from "../dist/server/index.js";
import { createPool, createPostStorage, initializeDatabase } from "./database.mjs";

const env = process.env;
const local = process.argv.includes("--local");
const port = Number(env.DATABRICKS_APP_PORT ?? (local ? 8000 : NaN));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid DATABRICKS_APP_PORT.");
const origin = local ? `http://127.0.0.1:${port}` : new URL(env.DATABRICKS_APP_URL).origin;
if (!local && !origin.startsWith("https://")) throw new Error("DATABRICKS_APP_URL must use HTTPS.");

const pool = createPool();
pool.on("error", (error) => console.error("Lakebase idle connection error", error.code ?? error.name));
await initializeDatabase(pool);
const bindings = { DB: createPostStorage(pool), SOCIALAPIS_API_KEY: env.SOCIALAPIS_API_KEY };

const server = createServer(async (req, res) => {
  try {
    if (!req.url?.startsWith("/") || req.url.startsWith("//")) {
      res.writeHead(400).end();
      return;
    }
    const headers = new Headers(req.headers);
    headers.delete("oai-authenticated-user-id");
    const identity = local ? "local-user" : headers.get("x-forwarded-user");
    if (identity) headers.set("oai-authenticated-user-id", identity);

    let body;
    if (!["GET", "HEAD"].includes(req.method)) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 1_250_000) {
          res.writeHead(413, { Connection: "close" }).end();
          return;
        }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
    const request = new Request(origin + req.url, { method: req.method, headers, body });
    const response = await worker.fetch(request, bindings);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("Tracker request failed", error.code ?? error.name);
    res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      .end(JSON.stringify({ message: "Tracker ตอบกลับไม่สำเร็จ" }));
  }
});
server.listen(port, local ? "127.0.0.1" : "0.0.0.0");
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close(() => pool.end()));
