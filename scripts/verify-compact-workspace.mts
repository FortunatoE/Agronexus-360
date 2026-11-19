import { neon } from "@neondatabase/serverless";
import { gunzipSync } from "node:zlib";
import { buildFarmToNucleus, buildReconciliation } from "../lib/reconciliation.ts";

const sql = neon(process.env.DATABASE_URL!);
const [stored] = await sql`SELECT payload FROM agronexus_platform_workspace WHERE workspace_key = 'operacional'`;
const payload = stored.payload;
const workspace = payload.encoding === "gzip-base64"
  ? JSON.parse(gunzipSync(Buffer.from(payload.data, "base64url")).toString("utf8"))
  : payload.data;
const datasets = workspace.datasets;
const farmToNucleus = buildFarmToNucleus([...datasets.planejamento, ...datasets.execucao], workspace.bundle, datasets.planejamento);
const ledger = buildReconciliation({
  bundle: workspace.bundle,
  planningRows: datasets.planejamento,
  stockRows: [...datasets.estoque, ...datasets.estoqueMb52],
  transitRows: datasets.transito,
  consumptionRows: datasets.consumo,
  pendingRows: datasets.pedidos,
  farmToNucleus,
});
console.log(JSON.stringify({ compact: datasets.planejamento[0]?._c === 1, ledgerRows: ledger.length, planned: Math.round(ledger.reduce((sum: number, row: { planned: number }) => sum + row.planned, 0)), applied: Math.round(ledger.reduce((sum: number, row: { applied: number }) => sum + row.applied, 0)) }));
