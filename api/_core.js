import { neon } from "@neondatabase/serverless";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { pendingOrderDetailFields, pendingOrderQuantityAliases } from "../lib/pending-order-fields.mjs";

const scrypt = promisify(scryptCallback);
let schemaReady;

function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não está configurada.");
  return neon(process.env.DATABASE_URL);
}

export async function ensureSchema() {
  if (!schemaReady) schemaReady = (async () => {
    const db = sql();
    await db`CREATE TABLE IF NOT EXISTS agronexus_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      nucleus TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await db`CREATE TABLE IF NOT EXISTS agronexus_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES agronexus_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await db`CREATE TABLE IF NOT EXISTS agronexus_workspaces (
      user_id TEXT PRIMARY KEY REFERENCES agronexus_users(id) ON DELETE CASCADE,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await db`CREATE TABLE IF NOT EXISTS agronexus_platform_workspace (
      workspace_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await db`ALTER TABLE agronexus_users ADD COLUMN IF NOT EXISTS nucleus TEXT NOT NULL DEFAULT ''`;
  })();
  return schemaReady;
}

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

export async function passwordRecord(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scrypt(String(password), salt, 64);
  return { passwordHash: Buffer.from(hash).toString("base64url"), passwordSalt: salt };
}

export async function passwordMatches(password, user) {
  const hash = await scrypt(String(password), user.password_salt, 64);
  const expected = Buffer.from(user.password_hash, "base64url");
  const received = Buffer.from(hash);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function publicUser(user) {
  return { id: user.id, username: user.username, name: user.display_name, role: user.role, nucleus: user.nucleus || "" };
}

export async function findUser(username) {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM agronexus_users WHERE username = ${normalizeUsername(username)} LIMIT 1`;
  return rows[0] || null;
}

export async function listUsers() {
  await ensureSchema();
  return sql()`SELECT id, username, display_name AS name, role, nucleus, created_at AS "createdAt" FROM agronexus_users ORDER BY created_at ASC`;
}

export async function createUser({ username, name, role = "viewer", nucleus = "", password }) {
  await ensureSchema();
  const normalized = normalizeUsername(username);
  if (!normalized || !password) throw new Error("Informe login e senha.");
  const { passwordHash, passwordSalt } = await passwordRecord(password);
  const id = `usr_${randomBytes(12).toString("base64url")}`;
  const rows = await sql()`INSERT INTO agronexus_users (id, username, display_name, role, nucleus, password_hash, password_salt)
    VALUES (${id}, ${normalized}, ${String(name || normalized).trim()}, ${role === "admin" ? "admin" : "viewer"}, ${String(nucleus || "").trim()}, ${passwordHash}, ${passwordSalt})
    RETURNING id, username, display_name, role, nucleus`;
  return publicUser(rows[0]);
}

async function administratorCount() {
  const rows = await sql()`SELECT COUNT(*)::int AS count FROM agronexus_users WHERE role = 'admin'`;
  return Number(rows[0]?.count || 0);
}

export async function updateUser({ id, username, name, password, role, nucleus = "" }) {
  await ensureSchema();
  const current = await sql()`SELECT * FROM agronexus_users WHERE id = ${String(id || "")} LIMIT 1`;
  const target = current[0];
  if (!target) throw new Error("Usuário não encontrado.");
  const nextRole = role === "admin" ? "admin" : "viewer";
  if (target.role === "admin" && nextRole !== "admin" && await administratorCount() <= 1) throw new Error("Mantenha pelo menos um administrador ativo.");
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error("Informe o login.");
  const nextPassword = String(password || "").trim();
  const credential = nextPassword ? await passwordRecord(nextPassword) : null;
  const rows = await sql()`UPDATE agronexus_users
    SET username = ${normalized}, display_name = ${String(name || normalized).trim() || normalized}, role = ${nextRole}, nucleus = ${String(nucleus || "").trim()},
      password_hash = COALESCE(${credential?.passwordHash || null}, password_hash),
      password_salt = COALESCE(${credential?.passwordSalt || null}, password_salt)
    WHERE id = ${target.id}
    RETURNING id, username, display_name, role, nucleus`;
  return publicUser(rows[0]);
}

export async function deleteUser(id, requesterId) {
  await ensureSchema();
  const current = await sql()`SELECT id, role FROM agronexus_users WHERE id = ${String(id || "")} LIMIT 1`;
  const target = current[0];
  if (!target) throw new Error("Usuário não encontrado.");
  if (target.id === requesterId) throw new Error("Use outro administrador para excluir esta conta.");
  if (target.role === "admin" && await administratorCount() <= 1) throw new Error("Não é possível excluir o último administrador.");
  await sql()`DELETE FROM agronexus_users WHERE id = ${target.id}`;
}

function cookieValue(request, key) {
  const values = String(request.headers?.cookie || "").split(";").map((item) => item.trim());
  return values.find((item) => item.startsWith(`${key}=`))?.slice(key.length + 1) || "";
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("base64url");
}

export async function currentUser(request) {
  await ensureSchema();
  const token = cookieValue(request, "agronexus_session");
  if (!token) return null;
  const rows = await sql()`SELECT u.id, u.username, u.display_name, u.role, u.nucleus FROM agronexus_sessions s
    JOIN agronexus_users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash(token)} AND s.expires_at > NOW() LIMIT 1`;
  return rows[0] ? publicUser(rows[0]) : null;
}

export async function createSession(response, userId) {
  await ensureSchema();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  await sql()`INSERT INTO agronexus_sessions (token_hash, user_id, expires_at) VALUES (${tokenHash(token)}, ${userId}, ${expiresAt})`;
  response.setHeader("Set-Cookie", `agronexus_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`);
}

export async function clearSession(request, response) {
  const token = cookieValue(request, "agronexus_session");
  if (token) {
    await ensureSchema();
    await sql()`DELETE FROM agronexus_sessions WHERE token_hash = ${tokenHash(token)}`;
  }
  response.setHeader("Set-Cookie", "agronexus_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
}

const compactSources = {
  planejamento: { product: ["Produto", "Material planejado", "Produto planejado", "Texto material", "Descrição material", "Descricao material"], quantity: ["Qtde. talhão", "Qtde talhão", "Volume ajustado (produto) padrão", "Quantidade"] },
  execucao: { product: ["Produto", "Material planejado", "Produto planejado", "Texto material", "Descrição material", "Descricao material"], quantity: ["Quantidade"] },
  consumo: { product: ["Texto material", "Texto breve material", "INSUMO", "Descrição material", "Descricao material", "Produto"], quantity: ["Qtd.retirada", "Qtd retirada", "Quantidade", "Saldo ajustado"] },
  estoque: { product: ["Texto breve material", "INSUMO", "Descrição material", "Descricao material", "Produto"], quantity: ["Util.livre", "Utilização livre", "Utiliza��o livre", "Utilizacao livre", "Saldo ajustado", "Estoque"] },
  estoqueMb52: { product: ["Texto breve material", "INSUMO", "Descrição material", "Descricao material", "Produto"], quantity: ["Util.livre", "Utilização livre", "Utiliza��o livre", "Utilizacao livre", "Saldo ajustado", "Estoque"] },
  transito: { product: ["Texto breve material", "INSUMO", "Descrição material", "Descricao material", "Produto"], quantity: ["Quantidade", "Qtd.pedido", "Qtd pedido", "Saldo ajustado"] },
  pedidos: { product: ["Descrição Material", "Descricao Material", "Produto solicitado", "Material solicitado", "Texto material", "Texto breve material"], quantity: pendingOrderQuantityAliases },
};

function compactHeader(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\uFFFD/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function compactRawValue(values, aliases) {
  for (const alias of aliases) {
    const candidate = compactHeader(alias);
    const exact = values.get(candidate);
    if (exact !== undefined && exact !== null && (typeof exact === "number" || String(exact).trim())) return exact;
    if (candidate.length > 7) {
      for (const [current, value] of values) {
        if (current.startsWith(candidate) && value !== undefined && value !== null && (typeof value === "number" || String(value).trim())) return value;
      }
    }
  }
  return undefined;
}

function compactRow(row, source) {
  if (!row || typeof row !== "object" || row._c === 1) return row;
  const values = new Map(Object.entries(row).map(([header, value]) => [compactHeader(header), value]));
  const compact = { _c: 1 };
  const assign = (key, ...aliases) => {
    const value = compactRawValue(values, aliases);
    if (value !== undefined) compact[key] = value;
  };
  const config = compactSources[source];
  assign("s", "Status", "Situação", "Situacao");
  assign("cl", "Classificação", "Classificacao", "Classificac�o", "Tipo");
  assign("p", ...config.product);
  assign("q", ...config.quantity);
  assign("aq", "Volume ajustado (produto) padrão", "Volume ajustado (produto) padrao");
  assign("c", "Material", "Código material", "Codigo material", "MAT");
  assign("w", "WBS element", "WBS", "Elemento PEP", "Elemento WBS", "Def.proj.", "Def proj", "Projeto");
  assign("ce", "Cen.", "Centro", "CEN", "Fazenda", "Nome Fazenda"); assign("t", "Talhao", "Talhão"); assign("cu", "Cultura", "Cultura 1"); assign("cy", "Ciclo Plantio", "Ciclo"); assign("n", "Nucleo", "Núcleo");
  assign("d", "Dep.", "Depósito", "Deposito", "DEP"); assign("op", "Nome Est.Esp.", "Nome Est Esp", "Armazém", "Armazem"); assign("ct", "Local Est.Esp.", "Local Est Esp", "Cidade");
  assign("dg", "DiagRede", "Diagrama"); assign("ta", "Tar.", "Operação", "Operacao", "Operações", "Operacoes", "Descr. Operação", "Descr Operação"); assign("ac", "Atividade");
  assign("pa", "Área executar (HA)", "Area executar (HA)", "HA_plantio", "HA plantio", "HA_talhao", "HA talhão"); assign("aa", "Área Executada", "Area Executada", "Qtde. executada");
  assign("pd", "Data de plantio", "Data Plantio", "Dt. Plantio", "Dt Plantio", "DT_Plantio", "DATA_PLANTIO", "Plantio"); assign("nq", "Qtd.necess.", "Qtd necess.", "Quantidade necessária", "Quantidade necessaria");
  assign("ad", "DT_Aplicacao", "Data prevista", "Data planejada", "Data aplicação", "Data"); assign("rd", "DtRemPed", "Dt. Rem. Ped", "Data remessa", "Previsão de utilização", "Previsao de utilizacao");
  assign("or", "Pedido", "Nº pedido", "No pedido", "Documento", "Doc. compra", "Solicitação", "Solicitacao"); assign("ex", "Dt. Validade", "Dt Validade", "Data de validade", "Data Validade", "Validade");
  assign("va", "Valor total", "Valor Total", "Valor", "Val. total", "Valor estoque"); assign("el", "Eliminado?", "Eliminado", "Cancelado");
  if (source === "pedidos") {
    for (const { key, aliases } of Object.values(pendingOrderDetailFields)) assign(key, ...aliases);
  }
  return compact;
}

function compactWorkspacePayload(payload) {
  try {
    const workspace = payload?.encoding === "gzip-base64"
      ? JSON.parse(gunzipSync(Buffer.from(payload.data, "base64url")).toString("utf8"))
      : payload?.data;
    if (!workspace?.datasets || typeof workspace.datasets !== "object") return { changed: false, payload };
    let changed = false;
    const datasets = {};
    for (const [source, rows] of Object.entries(workspace.datasets)) {
      if (!Array.isArray(rows) || !compactSources[source]) { datasets[source] = rows; continue; }
      const isCompact = rows.every((row) => row && typeof row === "object" && row._c === 1);
      datasets[source] = isCompact ? rows : rows.map((row) => compactRow(row, source));
      changed ||= !isCompact;
    }
    if (!changed) return { changed: false, payload };
    const data = { ...workspace, datasets };
    return { changed: true, payload: { encoding: "gzip-base64", data: gzipSync(JSON.stringify(data)).toString("base64url"), version: 2 } };
  } catch {
    return { changed: false, payload };
  }
}

export async function readWorkspace() {
  await ensureSchema();
  const rows = await sql()`SELECT payload, updated_at AS "updatedAt" FROM agronexus_platform_workspace WHERE workspace_key = 'operacional' LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  const compacted = compactWorkspacePayload(row.payload);
  if (!compacted.changed) return row;
  await sql()`UPDATE agronexus_platform_workspace SET payload = ${JSON.stringify(compacted.payload)}::jsonb, updated_at = NOW() WHERE workspace_key = 'operacional'`;
  return { ...row, payload: compacted.payload, updatedAt: new Date().toISOString() };
}

export async function writeWorkspace(_userId, payload) {
  await ensureSchema();
  const rows = await sql()`INSERT INTO agronexus_platform_workspace (workspace_key, payload, updated_at)
    VALUES ('operacional', ${JSON.stringify(payload)}::jsonb, NOW())
    ON CONFLICT (workspace_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
    RETURNING updated_at AS "updatedAt"`;
  return rows[0];
}

export function sendError(response, status, error) {
  return response.status(status).json({ error });
}
