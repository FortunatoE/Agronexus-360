import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { currentUser, listUsers, sendError } from "./_core.js";
import { sapLotHeaders, sapUnitHeaders } from "../lib/sap-logistics-fields.mjs";

const STAGES = { fiscal: "Aguardando notas fiscais", recipe: "Aguardando receituário", done: "Concluída", deletion_pending: "Aguardando confirmação de exclusão", deleted: "Excluída" };
const DOC_TYPES = ["devolucao", "transferencia", "receituario"];
const norm = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
let ready;
async function schema(db) {
  if (!ready) ready = (async () => {
    await db`CREATE TABLE IF NOT EXISTS agronexus_transfers (
      id TEXT PRIMARY KEY, origin_nucleus TEXT NOT NULL, destination_nucleus TEXT NOT NULL,
      requester_id TEXT NOT NULL, agronomist_id TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'fiscal', payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await db`CREATE TABLE IF NOT EXISTS agronexus_transfer_documents (
      id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL REFERENCES agronexus_transfers(id),
      kind TEXT NOT NULL, name TEXT NOT NULL, content BYTEA NOT NULL, bytes INTEGER NOT NULL,
      actor TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await db`CREATE INDEX IF NOT EXISTS agronexus_transfer_documents_transfer_idx ON agronexus_transfer_documents(transfer_id)`;
    await db`ALTER TABLE agronexus_transfers ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0`;
  })().catch((error) => { ready = undefined; throw error; });
  return ready;
}

async function readCentral(db) {
  const rows = await db`SELECT payload FROM agronexus_platform_workspace WHERE workspace_key = 'operacional' LIMIT 1`;
  let workspace = rows[0]?.payload;
  if (workspace?.encoding === "gzip-base64") workspace = JSON.parse(gunzipSync(Buffer.from(workspace.data, "base64url")).toString("utf8"));
  else if (workspace?.encoding === "json") workspace = workspace.data;
  return workspace;
}

function centersFrom(workspace) {
  const result = { FNA1: "NC-NSA", FAV1: "NC-AGV", FBE1: "NC-BES", ...(workspace?.bundle?.centerToNucleus || {}) };
  for (const item of workspace?.dimensionPremises || []) {
    if (["CENTRO", "FAZENDA"].includes(norm(item.domain)) && item.key && item.value) result[norm(item.key)] = item.value;
  }
  return Object.entries(result).filter(([code, nucleus]) => /^[A-Z0-9]{4}$/.test(code) && String(nucleus).startsWith("NC-")).map(([code, nucleus]) => ({ code, nucleus: String(nucleus).replace("NC-VER", "NC-AGV") })).sort((a,b) => a.code.localeCompare(b.code));
}
async function centers(db) { return centersFrom(await readCentral(db)); }

function stockValue(row, compact, aliases) {
  if (row._c === 1) return row[compact];
  const values = new Map(Object.entries(row).map(([key, value]) => [norm(key), value]));
  for (const alias of aliases) {
    const value = values.get(norm(alias));
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}
function stockQuantity(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!/^-?\d+(?:[.,]\d+)*$/.test(raw)) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "") : raw;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}
function stockOptions(workspace, origin) {
  // ZMM_BATCH exclusively: never substitute MB52, aggregate material or converted balances.
  const rows = Array.isArray(workspace?.datasets?.estoque) ? workspace.datasets.estoque : [];
  const grouped = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const read = (compact, aliases) => clean(stockValue(row, compact, aliases));
    const center = norm(read("ce", ["Cen.", "Centro", "CEN", "Fazenda"]));
    if (center !== origin) continue;
    const code = read("c", ["Material", "Código material", "Codigo material", "MAT", "CD MAT"]);
    const material = read("p", ["Texto breve material", "INSUMO", "Descrição material", "Descricao material", "Produto"]);
    const lot = read("lot", sapLotHeaders);
    const depot = read("d", ["Dep.", "Depósito", "Deposito", "DEP"]);
    const unit = read("um", sapUnitHeaders);
    const expiry = read("ex", ["Dt. Validade", "Dt Validade", "Data de validade", "Data Validade", "Validade"]);
    const available = stockQuantity(stockValue(row, "q", ["Util.livre", "Utilização livre", "Utilizacao livre", "EST", "Estoque"]));
    if (!code || !material || !lot || !unit || !depot || available === null) continue;
    const key = JSON.stringify([center, depot, code, lot, unit]);
    const existing = grouped.get(key);
    if (existing) {
      existing.available += available;
      if (existing.expiry !== expiry) existing.expiry = "";
      if (existing.material !== material) existing.ambiguous = true;
    } else grouped.set(key, { key, center, depot, code, material, lot, unit, expiry, available, ambiguous: false });
  }
  return [...grouped.values()].filter((item) => item.available > 0 && !item.ambiguous).map(({ ambiguous, ...item }) => item)
    .sort((a,b) => a.material.localeCompare(b.material, "pt-BR") || a.lot.localeCompare(b.lot) || a.depot.localeCompare(b.depot));
}

function authorizeOrigin(user, workspace, originCode) {
  const origin = centersFrom(workspace).find((unit) => unit.code === norm(originCode));
  if (!origin) fail("Unidade de origem não cadastrada.");
  if (user.role !== "admin" && (!user.nucleus || norm(user.nucleus) !== norm(origin.nucleus))) fail("Você só pode solicitar pela unidade do seu núcleo.", 403);
  return origin;
}

const allowed = (user, row) => user.role === "admin" || row.requester_id === user.id || row.agronomist_id === user.id ||
  (!!user.nucleus && [row.origin_nucleus, row.destination_nucleus].some((n) => norm(n) === norm(user.nucleus)));
const canRecipe = (user, row) => user.role === "admin" || row.agronomist_id === user.id;
const actor = (user) => user.name || user.username;
const entry = (user, action) => ({ actor: actor(user), action, at: new Date().toISOString() });
async function load(db, id, user) {
  const rows = await db`SELECT * FROM agronexus_transfers WHERE id = ${id} LIMIT 1`;
  if (!rows[0] || !allowed(user, rows[0])) fail("Transferência não encontrada.", 404);
  return rows[0];
}
async function list(db, user) {
  const rows = await db`SELECT t.id, t.origin_nucleus, t.destination_nucleus, t.requester_id, t.agronomist_id, t.stage, t.payload, t.revision, t.created_at, t.updated_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'name', d.name, 'bytes', d.bytes, 'actor', d.actor, 'at', d.created_at) ORDER BY d.created_at)
      FROM agronexus_transfer_documents d WHERE d.transfer_id = t.id), '[]'::jsonb) AS documents
    FROM agronexus_transfers t ORDER BY t.created_at DESC`;
  return rows.filter((row) => allowed(user, row)).map((row) => ({
    id: row.id, ...row.payload, stage: row.stage, status: STAGES[row.stage], agronomistId: row.agronomist_id,
    originNucleus: row.origin_nucleus, destinationNucleus: row.destination_nucleus, documents: row.documents,
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision,
    isMine: row.requester_id === user.id,
    isOutgoing: !!user.nucleus && norm(row.origin_nucleus) === norm(user.nucleus),
    isIncoming: !!user.nucleus && norm(row.destination_nucleus) === norm(user.nucleus),
    isAssigned: row.agronomist_id === user.id,
    canEdit: user.role === "admin" && row.stage === "fiscal" && !row.documents.length,
    canRequestDeletion: user.role === "admin" && !["deletion_pending", "deleted"].includes(row.stage) && row.requester_id !== user.id,
    canConfirmDeletion: row.stage === "deletion_pending" && row.requester_id === user.id && row.payload.deletion?.requestedById !== user.id,
    canFiscal: user.role === "admin" && row.stage === "fiscal",
    canRecipe: canRecipe(user, row) && row.stage === "recipe",
  }));
}

export default async function handler(req, res) {
  try {
    const user = await currentUser(req);
    if (!user) return sendError(res, 401, "Sessão expirada.");
    const db = neon(process.env.DATABASE_URL);
    await schema(db);
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") {
      const doc = clean(req.query?.document, 80);
      if (doc) {
        const files = await db`SELECT id, transfer_id, name, encode(content, 'base64') AS data FROM agronexus_transfer_documents WHERE id = ${doc} LIMIT 1`;
        if (!files[0]) fail("Documento não encontrado.", 404);
        await load(db, files[0].transfer_id, user);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(files[0].name));
        return res.status(200).send(Buffer.from(files[0].data, "base64"));
      }
      if (req.query?.origin) {
        const workspace = await readCentral(db);
        const origin = authorizeOrigin(user, workspace, req.query.origin);
        return res.status(200).json({ options: stockOptions(workspace, origin.code), importedAt: workspace?.imports?.estoque?.importedAt || null });
      }
      const units = await centers(db);
      const assignees = user.role === "admin" ? (await listUsers()).map((u) => ({ id: u.id, name: u.name, username: u.username })) : [];
      return res.status(200).json({ rows: await list(db, user), units, assignees });
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return sendError(res, 405, "Método não permitido."); }
    const body = req.body || {};
    if (body.action === "create" || body.action === "edit") {
      const editing = body.action === "edit";
      const previous = editing ? await load(db, clean(body.id, 80), user) : null;
      if (editing && (user.role !== "admin" || previous.stage !== "fiscal")) fail("Edição permitida apenas ao administrador antes do encaminhamento fiscal.", 403);
      if (editing && Number(body.revision) !== previous.revision) fail("A transferência mudou. Atualize antes de editar.", 409);
      const workspace = await readCentral(db);
      const origin = authorizeOrigin(user, workspace, body.origin);
      const destination = centersFrom(workspace).find((u) => u.code === norm(body.destination));
      if (!destination || origin.code === destination.code) fail("Selecione origem e destino diferentes e cadastrados.");
      const requester = clean(body.requester);
      if (!requester) fail("Informe o solicitante.");
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) fail("Informe de 1 a 100 materiais.");
      const available = new Map(stockOptions(workspace, origin.code).map((item) => [item.key, item]));
      const requested = new Map();
      const items = body.items.map((item) => {
        const stock = available.get(String(item.stockKey || ""));
        const quantity = Number(item.quantity);
        if (!stock || !Number.isFinite(quantity) || quantity <= 0) fail("Selecione um lote disponível da ZMM_BATCH e informe quantidade positiva.");
        const total = (requested.get(stock.key) || 0) + quantity;
        if (total - stock.available > 0.000001) fail("Quantidade solicitada supera o saldo físico do lote " + stock.lot + " (" + stock.material + " / " + stock.depot + ").");
        requested.set(stock.key, total);
        return { id: randomUUID(), code: stock.code, material: stock.material, lot: stock.lot, unit: stock.unit, depot: stock.depot, expiry: stock.expiry, availableAtRequest: stock.available, quantity, stockKey: stock.key };
      });
      const id = editing ? previous.id : randomUUID();
      const payload = { ...(editing ? previous.payload : {}), origin: origin.code, destination: destination.code, requester, createdBy: editing ? previous.payload.createdBy : actor(user), observation: clean(body.observation, 4000), stockSource: "ZMM_BATCH", stockImportedAt: workspace?.imports?.estoque?.importedAt || null, items, history: [...(editing ? previous.payload.history || [] : []), entry(user, editing ? "Transferência editada pelo administrador" : "Solicitação registrada")] };
      if (editing) {
        payload.history[payload.history.length - 1].before = { origin: previous.payload.origin, destination: previous.payload.destination, requester: previous.payload.requester, observation: previous.payload.observation, items: previous.payload.items };
        const changed = await db`UPDATE agronexus_transfers SET origin_nucleus = ${origin.nucleus}, destination_nucleus = ${destination.nucleus}, payload = ${JSON.stringify(payload)}::jsonb, revision = revision + 1, updated_at = NOW()
          WHERE id = ${id} AND stage = 'fiscal' AND revision = ${previous.revision}
          AND NOT EXISTS (SELECT 1 FROM agronexus_transfer_documents WHERE transfer_id = ${id}) RETURNING id`;
        if (!changed.length) fail("Não foi possível editar: há documentos anexados ou a transferência foi alterada.", 409);
        return res.status(200).json({ id });
      }
      await db`INSERT INTO agronexus_transfers (id, origin_nucleus, destination_nucleus, requester_id, payload) VALUES (${id}, ${origin.nucleus}, ${destination.nucleus}, ${user.id}, ${JSON.stringify(payload)}::jsonb)`;
      return res.status(201).json({ id });
    }
    const row = await load(db, clean(body.id, 80), user);
    if (body.action === "requestDeletion" || body.action === "confirmDeletion" || body.action === "rejectDeletion") {
      const requesting = body.action === "requestDeletion";
      const confirming = body.action === "confirmDeletion";
      const deletion = row.payload.deletion;
      if (requesting) {
        if (user.role !== "admin" || ["deletion_pending", "deleted"].includes(row.stage)) fail("Exclusão não permitida.", 403);
        if (row.requester_id === user.id) fail("Outro administrador deve iniciar a exclusão de uma solicitação criada por você.", 403);
      } else if (row.stage !== "deletion_pending" || row.requester_id !== user.id || deletion?.requestedById === user.id) fail("Somente o usuário que criou a solicitação pode confirmar ou recusar esta exclusão.", 403);
      const reason = clean(body.reason, 1000);
      if (requesting && !reason) fail("Informe o motivo da exclusão.");
      const next = requesting ? "deletion_pending" : confirming ? "deleted" : deletion.previousStage;
      if (!["fiscal", "recipe", "done", "deletion_pending", "deleted"].includes(next)) fail("Estado inválido.", 409);
      const payload = { ...row.payload,
        deletion: requesting ? { requestedById: user.id, requestedBy: actor(user), requestedAt: new Date().toISOString(), previousStage: row.stage, reason }
          : { ...deletion, decidedBy: actor(user), decidedAt: new Date().toISOString(), decision: confirming ? "confirmed" : "rejected" },
        history: [...(row.payload.history || []), entry(user, requesting ? "Exclusão solicitada: " + reason : confirming ? "Exclusão confirmada pelo solicitante (registro arquivado)" : "Exclusão recusada pelo solicitante; fluxo restaurado")]
      };
      const changed = await db`UPDATE agronexus_transfers SET stage = ${next}, payload = ${JSON.stringify(payload)}::jsonb, revision = revision + 1, updated_at = NOW()
        WHERE id = ${row.id} AND stage = ${row.stage} AND revision = ${row.revision} RETURNING id`;
      if (!changed.length) fail("A transferência mudou. Atualize a lista.", 409);
      return res.status(200).json({ ok: true });
    }
    if (body.action === "upload") {
      const kind = clean(body.kind, 30);
      if (!DOC_TYPES.includes(kind)) fail("Tipo de documento inválido.");
      if (kind === "receituario" ? row.stage !== "recipe" || !canRecipe(user, row) : row.stage !== "fiscal" || user.role !== "admin") fail("Documento não permitido nesta etapa.", 403);
      const name = clean(body.name, 180).replace(/[\r\n/\\]/g, "_");
      const data = String(body.data || "");
      if (!name.toLowerCase().endsWith(".pdf") || data.length > 2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) fail("Envie um PDF de até 2 MB.");
      const buffer = Buffer.from(data, "base64");
      if (buffer.length > 2 * 1024 * 1024 || buffer.subarray(0, 5).toString() !== "%PDF-") fail("Arquivo PDF inválido ou acima de 2 MB.");
      const inserted = await db`WITH locked AS (
        UPDATE agronexus_transfers SET revision = revision + 1, updated_at = NOW()
        WHERE id = ${row.id} AND stage = ${row.stage} AND revision = ${row.revision} RETURNING id
      ) INSERT INTO agronexus_transfer_documents (id, transfer_id, kind, name, content, bytes, actor)
        SELECT ${randomUUID()}, id, ${kind}, ${name}, decode(${data}, 'base64'), ${buffer.length}, ${actor(user)}
        FROM locked RETURNING id`;
      if (!inserted.length) fail("A etapa foi alterada. Atualize a lista.", 409);
      return res.status(201).json({ ok: true });
    }
    if (body.action === "forward" || body.action === "complete") {
      const forward = body.action === "forward";
      if (forward ? user.role !== "admin" || row.stage !== "fiscal" : row.stage !== "recipe" || !canRecipe(user, row)) fail("Etapa não permitida.", 403);
      const docs = await db`SELECT DISTINCT kind FROM agronexus_transfer_documents WHERE transfer_id = ${row.id}`;
      const kinds = new Set(docs.map((d) => d.kind));
      if (forward ? !kinds.has("devolucao") || !kinds.has("transferencia") : !kinds.has("receituario")) fail(forward ? "Anexe as notas de devolução e transferência." : "Anexe pelo menos um receituário.");
      const assignee = forward ? (await listUsers()).find((u) => u.id === clean(body.agronomistId, 80)) : null;
      if (forward && !assignee) fail("Selecione um responsável cadastrado pelo receituário.");
      const next = forward ? "recipe" : "done";
      const payload = { ...row.payload, ...(forward ? { agronomistName: assignee.name } : {}), history: [...(row.payload.history || []), entry(user, forward ? "Notas anexadas; encaminhado para " + assignee.name : "Receituários anexados; fluxo documental concluído")] };
      const changed = await db`UPDATE agronexus_transfers SET stage = ${next}, agronomist_id = ${forward ? assignee.id : row.agronomist_id}, payload = ${JSON.stringify(payload)}::jsonb, revision = revision + 1, updated_at = NOW() WHERE id = ${row.id} AND stage = ${row.stage} AND revision = ${row.revision} RETURNING id`;
      if (!changed.length) fail("A etapa foi alterada. Atualize a lista.", 409);
      return res.status(200).json({ ok: true });
    }
    fail("Ação inválida.");
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    console.error("Transfer workflow", error);
    return sendError(res, 500, "Não foi possível acessar as transferências.");
  }
}
