import { readFile } from "node:fs/promises";
import pg from "pg";

const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
const earlyRefresh = 5 * 60 * 1000;

function cachedToken(load) {
  let current;
  let refreshing;
  return async () => {
    if (current && current.expires > Date.now() + earlyRefresh) return current.token;
    refreshing ??= load().then((credential) => {
      if (typeof credential.token !== "string" || !credential.token || !Number.isFinite(credential.expires) ||
          credential.expires <= Date.now()) throw new Error("Invalid Databricks credential response.");
      current = credential;
      return current.token;
    }).finally(() => { refreshing = null; });
    return refreshing;
  };
}

async function fetchCredential(url, headers, body) {
  const response = await fetch(url, {
    method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Databricks credential endpoint returned HTTP ${response.status}.`);
  return response.json();
}

export function createPool(env = process.env) {
  if (env.DATABASE_URL) return new pg.Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 15000 });

  for (const key of ["PGHOST", "PGUSER", "PGDATABASE", "ENDPOINT_NAME", "DATABRICKS_HOST", "DATABRICKS_CLIENT_ID", "DATABRICKS_CLIENT_SECRET"]) {
    if (!env[key]) throw new Error(`Missing Lakebase setting ${key}.`);
  }
  if (!/^projects\/[^/<>]+\/branches\/[^/<>]+\/endpoints\/[^/<>]+$/.test(env.ENDPOINT_NAME)) {
    throw new Error("Set ENDPOINT_NAME to the Lakebase Autoscaling compute resource name.");
  }
  const host = new URL(env.DATABRICKS_HOST);
  if (host.protocol !== "https:") throw new Error("DATABRICKS_HOST must use HTTPS.");
  const basic = Buffer.from(env.DATABRICKS_CLIENT_ID + ":" + env.DATABRICKS_CLIENT_SECRET).toString("base64");
  const workspaceToken = cachedToken(async () => {
    const result = await fetchCredential(new URL("/oidc/v1/token", host), {
      Authorization: "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded",
    }, new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" }));
    return { token: result.access_token, expires: Date.now() + Number(result.expires_in) * 1000 };
  });
  const databaseToken = cachedToken(async () => {
    const result = await fetchCredential(new URL("/api/2.0/postgres/credentials", host), {
      Authorization: "Bearer " + await workspaceToken(), "Content-Type": "application/json",
    }, JSON.stringify({ endpoint: env.ENDPOINT_NAME }));
    return { token: result.token, expires: Date.parse(result.expire_time) };
  });
  return new pg.Pool({
    host: env.PGHOST,
    port: Number(env.PGPORT ?? 5432),
    database: env.PGDATABASE,
    user: env.PGUSER,
    password: databaseToken,
    ssl: { rejectUnauthorized: true },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
  });
}

export async function inTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeDatabase(pool) {
  await inTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(180446535)");
    await client.query(schema);
  });
}

export function createPostStorage(pool) {
  return {
    prepare(sql) {
      let index = 0;
      const text = sql.replace(/\?/g, () => "$" + ++index);
      return {
        bind(...values) {
          return {
            async all() {
              const { rows } = await pool.query(text, values);
              return { results: rows.map((row) => ({ ...row, created_at: Number(row.created_at) })) };
            },
            async run(client = pool) {
              const { rowCount } = await client.query(text, values);
              return { meta: { changes: rowCount } };
            },
          };
        },
      };
    },
    async batch(statements) {
      return inTransaction(pool, async (client) => {
        for (const statement of statements) await statement.run(client);
      });
    },
  };
}
