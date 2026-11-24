import { neon } from "@neondatabase/serverless";
import XLSX from "xlsx";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const requestedPath = process.argv[2];
const sourcePath = requestedPath ? resolve(requestedPath) : "";
const dryRun = process.argv.includes("--dry-run");
if (!sourcePath || !existsSync(sourcePath)) {
  throw new Error("Informe o caminho do arquivo COMPRAS.xlsx.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não está configurada.");
}

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toUpperCase()
  .replace(/\s+/g, " ")
  .trim();

const text = (value) => String(value ?? "").trim();

function asNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const source = text(value);
  if (!source) return 0;
  const clean = source.replace(/[^\d,.-]/g, "");
  if (!clean) return 0;
  if (clean.includes(",") && clean.includes(".")) {
    const lastComma = clean.lastIndexOf(",");
    const lastDot = clean.lastIndexOf(".");
    return Number(lastComma > lastDot ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(/,/g, "")) || 0;
  }
  return Number(clean.replace(",", ".")) || 0;
}

function asDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const source = text(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(source)) return source.slice(0, 10);
  const brazilian = source.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return brazilian ? `${brazilian[3]}-${brazilian[2].padStart(2, "0")}-${brazilian[1].padStart(2, "0")}` : "";
}

function titleCulture(value) {
  const current = normalize(value);
  if (current === "SOJA") return "Soja";
  if (current === "ALGODAO") return "Algodão";
  if (current === "MILHO") return "Milho";
  if (current === "CORRETIVOS") return "Corretivos";
  if (current === "OUTRAS") return "Outras";
  return text(value);
}

function cycleForCulture(culture) {
  return ["SOJA", "CORRETIVOS"].includes(normalize(culture)) ? "Safra" : "Safrinha";
}

function roughKey(record) {
  return [
    normalize(record.supplier ?? record.Fornecedor),
    normalize(record.product ?? record.Material),
    normalize(record.destination ?? record.Centro),
    normalize(record.culture ?? record.Cultura),
    asNumber(record.totalVolume ?? record.Quantidade),
  ].join("|");
}

function sourceKey(row, index) {
  return [
    text(row["Ordem de Compra"]),
    text(row["L. Ped."]),
    normalize(row.Material),
    normalize(row.Centro),
    String(index + 1).padStart(3, "0"),
  ].join("|");
}

function decodePayload(payload) {
  if (payload?.encoding === "gzip-base64" && typeof payload.data === "string") {
    return JSON.parse(gunzipSync(Buffer.from(payload.data, "base64url")).toString("utf8"));
  }
  return payload?.encoding === "json" ? payload.data : payload;
}

function encodePayload(workspace) {
  return {
    encoding: "gzip-base64",
    data: gzipSync(JSON.stringify(workspace)).toString("base64url"),
    version: 2,
  };
}

const monthColumns = [
  ["Maio", "2026-05"], ["Junho", "2026-06"], ["Julho", "2026-07"], ["Agosto", "2026-08"],
  ["Setembro", "2026-09"], ["Outubro", "2026-10"], ["Novembro", "2026-11"], ["Dezembro", "2026-12"],
  ["Janeiro", "2027-01"], ["Fevereiro", "2027-02"], ["Março", "2027-03"], ["Abril", "2027-04"],
];

const workbook = XLSX.readFile(sourcePath, { cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
if (!rows.length) throw new Error("A planilha COMPRAS não possui linhas para importar.");

const sql = neon(process.env.DATABASE_URL);
const [stored] = await sql`SELECT payload FROM agronexus_platform_workspace WHERE workspace_key = 'operacional'`;
if (!stored?.payload) throw new Error("A carga operacional central não foi encontrada.");

const workspace = decodePayload(stored.payload);
const previous = Array.isArray(workspace?.commercialClosings?.closings)
  ? workspace.commercialClosings.closings
  : [];
const imported = previous.filter((closing) =>
  String(closing?.id || "").startsWith("legado-fechamento-26-27-") || closing?.sourceType === "compras-26-27",
);
const manual = previous.filter((closing) => !imported.includes(closing));

const priorBySourceKey = new Map(
  imported.filter((closing) => closing?.sourceKey).map((closing) => [closing.sourceKey, closing]),
);
const importedQueues = new Map();
for (const closing of imported.filter((closing) => !closing?.sourceKey)) {
  const key = roughKey(closing);
  const queue = importedQueues.get(key) || [];
  queue.push(closing);
  importedQueues.set(key, queue);
}
const activeByProduct = new Map(
  imported.filter((closing) => closing?.active).map((closing) => [normalize(closing.product), closing.active]),
);

const importedAt = new Date().toISOString();
const idMap = new Map();
const closings = rows.map((row, index) => {
  const currentSourceKey = sourceKey(row, index);
  const matchingQueue = importedQueues.get(roughKey(row)) || [];
  const existing = priorBySourceKey.get(currentSourceKey) || matchingQueue.shift();
  const culture = titleCulture(row.Cultura);
  const currency = normalize(row.Moeda);
  const distribution = Object.fromEntries(
    monthColumns.map(([column, month]) => [month, asNumber(row[column])]).filter(([, quantity]) => quantity !== 0),
  );
  const id = existing?.id || `carga-compras-26-27-${String(index + 1).padStart(3, "0")}`;
  if (existing?.id) idMap.set(existing.id, id);
  return {
    id,
    sourceType: "compras-26-27",
    sourceKey: currentSourceKey,
    supplier: text(row.Fornecedor),
    paymentDue: asDate(row.Vencimento),
    paymentMethod: text(row["Origem Recurso"]),
    destination: text(row.Centro) || text(row.Filial),
    filial: text(row.Filial),
    deliveryLocation: text(row["Local de Entrega"]),
    cycle: cycleForCulture(culture),
    culture,
    active: existing?.active || activeByProduct.get(normalize(row.Material)) || "",
    product: text(row.Material),
    unit: existing?.unit || "",
    currency: currency === "USD" || currency === "BRL" ? currency : "",
    unitPrice: asNumber(row["Unitário Liq."] || row.Unitário),
    packaging: text(row.Embalagem),
    totalVolume: asNumber(row.Quantidade),
    distribution,
    orderKey: [
      text(row["Ordem de Compra"]),
      text(row["L. Ped."]),
      normalize(row.Material),
    ].join("|"),
    orderNumber: text(row["Ordem de Compra"]),
    orderItem: text(row["L. Ped."]),
    invoicedVolume: asNumber(row.Faturado),
    createdAt: existing?.createdAt || importedAt,
    updatedAt: importedAt,
  };
});

const annotations = Array.isArray(workspace.commercialClosings?.annotations)
  ? workspace.commercialClosings.annotations.map((annotation) => ({
      ...annotation,
      closingId: idMap.get(annotation.closingId) || annotation.closingId,
    }))
  : [];
const nextWorkspace = {
  ...workspace,
  commercialClosings: {
    ...(workspace.commercialClosings || {}),
    annotations,
    closings: [...closings, ...manual],
    source: {
      name: "COMPRAS.xlsx",
      importedAt,
      rows: closings.length,
      fields: ["Centro", "Filial", "Vencimento", "Origem Recurso"],
    },
  },
};

const summary = {
  sourceRows: rows.length,
  replacedImportedRecords: imported.length,
  preservedManualRecords: manual.length,
  resultingCommercialRecords: nextWorkspace.commercialClosings.closings.length,
  destinations: new Set(closings.map((closing) => closing.destination).filter(Boolean)).size,
  paymentOrigins: new Set(closings.map((closing) => closing.paymentMethod).filter(Boolean)).size,
  dueDates: closings.filter((closing) => closing.paymentDue).length,
  dryRun,
};

if (!dryRun) {
  const payload = encodePayload(nextWorkspace);
  await sql`UPDATE agronexus_platform_workspace SET payload = ${JSON.stringify(payload)}::jsonb, updated_at = NOW() WHERE workspace_key = 'operacional'`;
}
console.log(JSON.stringify(summary, null, 2));
