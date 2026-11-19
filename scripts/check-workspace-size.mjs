import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const [row] = await sql`SELECT
  octet_length(payload::text) AS json_bytes,
  payload->>'encoding' AS encoding,
  octet_length(COALESCE(payload->>'data', '')) AS data_bytes,
  updated_at
  FROM agronexus_platform_workspace
  WHERE workspace_key = 'operacional'`;

console.log(row ? JSON.stringify(row) : "Nenhuma carga central salva.");
