import { neon } from "@neondatabase/serverless";
import { gunzipSync } from "node:zlib";

const sql = neon(process.env.DATABASE_URL);
const [row] = await sql`SELECT payload FROM agronexus_platform_workspace WHERE workspace_key = 'operacional'`;
if (!row?.payload) {
  console.log("Nenhuma carga central salva.");
  process.exit(0);
}
const payload = row.payload;
const workspace = payload.encoding === "gzip-base64"
  ? JSON.parse(gunzipSync(Buffer.from(payload.data, "base64url")).toString("utf8"))
  : payload.data;
const counts = Object.fromEntries(Object.entries(workspace.datasets || {}).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0]));
console.log(JSON.stringify({ bytes: JSON.stringify(workspace).length, counts, tasks: Array.isArray(workspace.tasks) ? workspace.tasks.length : 0 }));
