"use client";

import { Fragment, startTransition, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { buildCommercialClosingOverview, matchesCommercialClosing, resolveCommercialClosings } from "@/lib/commercial-closings";
import { buildNotificationMailto, buildOutlookEml, buildTaskNotification, parseNotificationRecipients, resolveTaskNotificationOrders } from "@/lib/task-notification";
import { base64ToBytes } from "@/lib/workspace-base64";
import { CommercialClosingBalances } from "@/components/commercial-closing-balances";
import { CommercialClosingCalendar, type ClosingCalendarPeriod } from "@/components/commercial-closing-calendar";
import { DimensionUpload } from "@/components/dimension-upload";
import { emptyDimensionBundle, normalizeMaterial, type DimensionBundle } from "@/lib/material-dimension";
import {
  buildFarmToNucleus,
  buildReconciliation,
  consumptionNucleusFor,
  cultureFor,
  cycleFor,
  headerKey,
  numberFrom,
  planningNucleusFor,
  productFor,
  quantityFor,
  readNumber,
  readText,
  nucleusFor,
  stockLocationFor,
  stockNucleusFor,
  standardAmount,
  standardQuantity,
  type OperationalRow,
  type ReconciliationRow,
} from "@/lib/reconciliation";
import {
  AlertTriangle, BarChart3, Bell, CalendarDays, CheckCircle2, ChevronDown,
  ClipboardCheck, Download, FileUp, LayoutDashboard, Moon, PackageSearch,
  Menu, Search, Settings, ShieldCheck, SlidersHorizontal, Sprout, Sun, Upload,
  Truck, UsersRound, X,
} from "lucide-react";

type Row = OperationalRow;
type SourceKey = "planejamento" | "execucao" | "consumo" | "estoque" | "estoqueMb52" | "transito" | "pedidos" | "estoqueWeb" | "solicitacoesWeb" | "pedidosCompra";
type ImportKey = SourceKey | "dimensoes";
type Datasets = Record<SourceKey, Row[]>;
type ImportSummary = { fileName: string; fileModifiedAt: string; importedAt: string; rows: number; sheets: string[] };
type ImportHistoryItem = ImportSummary & { id: string; source: SourceKey; version: number; previousRows: number; warnings: number };
type AuditEvent = { id: string; actor: string; detail: string; kind: "import" | "premise" | "task" | "workspace"; createdAt: string };
type Premises = { tolerance: string; sample: string; horizon: string; excludedStatus: string };
type DimensionPremise = { domain: string; key: string; value: string };
type EmailSettings = { defaultCopy: string; nucleusRecipients: Record<string, string> };
type DashboardSettings = { daeCycle: "Safra" | "Safrinha" | "Ambos" };
type AppUser = { id: string; username: string; name: string; role: "admin" | "viewer" | string; nucleus?: string };
type ManagedUser = AppUser & { createdAt: string };
type UserDraft = { id?: string; name: string; nucleus: string; password: string; role: "admin" | "viewer"; username: string };
type TaskAction = { id: string; note: string; createdAt: string };
type TaskStatus = "Aberta" | "Em andamento" | "Aguardando" | "Concluída";
type TaskItem = { id: string; pendingId: string; material?: string; nucleus?: string; title: string; createdAt: string; actions: TaskAction[]; owner?: string; dueDate?: string; evidence?: string; status?: TaskStatus; updatedAt?: string };
type RoadDriver = { id: string; fullName: string; cpf: string; phone?: string; createdAt: string };
type RoadVehicle = { id: string; plate: string; capacity: number; model: string; createdAt: string };
type TripRecipe = { culture: string; target: string; dose: string };
type LogisticsTripItem = {
  id: string; requestId: string; requestDate: string; product: string; productCode: string; lot: string;
  quantity: number; unit: string; sourceWarehouse: string; destination: string; destinationCode: string;
};
type LogisticsTrip = {
  id: string; requestId: string; requestDate: string; product: string; productCode: string; lot: string;
  quantity: number; unit: string; sourceWarehouse: string; destination: string; destinationCode: string;
  driverId: string; vehicleId: string; invoiceNumber: string; createdAt: string; recipe?: TripRecipe; items?: LogisticsTripItem[];
};
type LogisticsState = { drivers: RoadDriver[]; trips: LogisticsTrip[]; vehicles: RoadVehicle[] };
type ClosingDistribution = Record<string, number>;
type CommercialCurrency = "" | "BRL" | "USD";
type CommercialClosing = {
  id: string;
  supplier: string;
  paymentDue: string;
  destination: string;
  deliveryLocation: string;
  cycle: "Safra" | "Safrinha";
  culture: string;
  active: string;
  product: string;
  unit: string;
  currency: CommercialCurrency;
  unitPrice: number;
  packaging: string;
  totalVolume: number;
  distribution: ClosingDistribution;
  orderKey: string;
  orderNumber: string;
  createdAt: string;
  updatedAt: string;
};
type ClosingAnnotation = {
  id: string;
  closingId: string;
  materialSent: string;
  purchaseVolume: number | null;
  invoicedVolume: number | null;
  note: string;
  resolved: boolean;
  createdAt: string;
};
type CommercialClosingsState = { annotations: ClosingAnnotation[]; closings: CommercialClosing[] };
type PersistedWorkspace = {
  bundle: DimensionBundle;
  datasets: Datasets;
  dimensionPremises: DimensionPremise[];
  imports: Partial<Record<ImportKey, ImportSummary>>;
  premises: Premises;
  tasks: TaskItem[] | string[];
  emailSettings?: EmailSettings;
  dashboardSettings?: DashboardSettings;
  importHistory?: ImportHistoryItem[];
  auditEvents?: AuditEvent[];
  logistics?: LogisticsState;
  commercialClosings?: CommercialClosingsState;
};
type ReconciliationIssue = { action: string; code: string; count: number; detail: string; material: string; source: string };
type PremiseSection = {
  id: "operacionais" | "materiais" | "nucleos" | "culturas" | "conversoes";
  title: string;
  description: string;
  headers: string[];
  rows: Array<Array<string | number>>;
};
type PendingSignal = {
  id: string;
  dueDate: Date | null;
  daysUntil: number | null;
  material: string;
  physicalMaterial: string;
  nucleus: string;
  quantity: number;
  reference: string;
  row: Row;
  status: "Demanda próxima" | "Possível atraso" | "Ponto de atenção" | "Alerta" | "Programado" | "Sem data";
  tone: "emerald" | "sky" | "amber" | "rose" | "slate";
};
type OperationalAlert = {
  id: string;
  category: string;
  severity: "attention" | "critical" | "info";
  title: string;
  detail: string;
  metric: string;
  warehouseBalances?: ReconciliationRow["locations"];
};

const workspaceDatabase = "agronexus-360";
const workspaceStore = "workspace";
const workspaceRecord = "current";
const emptyDatasets: Datasets = { planejamento: [], execucao: [], consumo: [], estoque: [], estoqueMb52: [], transito: [], pedidos: [], estoqueWeb: [], solicitacoesWeb: [], pedidosCompra: [] };
const initialPremises: Premises = { tolerance: "5", sample: "3", horizon: "7, 15, 30", excludedStatus: "EXCL" };
const initialEmailSettings: EmailSettings = { defaultCopy: "", nucleusRecipients: {} };
const initialDashboardSettings: DashboardSettings = { daeCycle: "Safra" };
const initialLogistics: LogisticsState = { drivers: [], trips: [], vehicles: [] };
const initialCommercialClosings: CommercialClosingsState = { annotations: [], closings: [] };
const emptyUserDraft: UserDraft = { name: "", nucleus: "", password: "", role: "viewer", username: "" };
function logisticsTripItems(trip: LogisticsTrip): LogisticsTripItem[] {
  return trip.items?.length ? trip.items : [{
    id: `legado-${trip.id}`, requestId: trip.requestId, requestDate: trip.requestDate, product: trip.product,
    productCode: trip.productCode, lot: trip.lot, quantity: trip.quantity, unit: trip.unit,
    sourceWarehouse: trip.sourceWarehouse, destination: trip.destination, destinationCode: trip.destinationCode,
  }];
}
let xlsxLoader: Promise<typeof import("xlsx")> | null = null;
function loadXlsx() { xlsxLoader ??= import("xlsx"); return xlsxLoader; }
const sourceConfig: Array<{ key: SourceKey; title: string; hint: string; header: number }> = [
  { key: "planejamento", title: "Planejamento", hint: "PLANEJAMENTO.xlsx", header: 0 },
  { key: "execucao", title: "Execução SAP", hint: "ZPS007.xlsx", header: 1 },
  { key: "consumo", title: "Consumo SAP", hint: "CN52.xlsx", header: 3 },
  { key: "estoque", title: "Estoque por lote", hint: "ZMM_BATCH.xlsx", header: 0 },
  { key: "estoqueMb52", title: "Estoque complementar", hint: "MB52.xlsx — somente materiais ausentes na BATCH", header: 1 },
  { key: "transito", title: "Materiais em trânsito", hint: "MB5T.xlsx", header: 1 },
  { key: "pedidos", title: "Pedidos pendentes", hint: "PEDIDOS PENDENTES.xlsx", header: 0 },
  { key: "estoqueWeb", title: "Estoque webAgil", hint: "Estoque webAgil.xlsx", header: 0 },
  { key: "solicitacoesWeb", title: "Solicitações webAgil", hint: "Relação de solicitação webAgil.xlsx", header: 0 },
  { key: "pedidosCompra", title: "Pedidos de compra", hint: "PEDIDOS COMPRA.xlsx", header: 1 },
];
const nav = [
  ["Visão geral", LayoutDashboard], ["Calendarização", CalendarDays],
  ["Acompanhamento", ClipboardCheck], ["Execução", PackageSearch],
  ["Importações", FileUp], ["Logística", Truck], ["Fechamentos", BarChart3], ["Alertas", Bell], ["Tarefas", ClipboardCheck],
  ["Usuários", UsersRound], ["Configurações", Settings],
] as const;
const crops = [
  { code: "ST1", name: "Soja", cycle: "Safra" },
  { code: "AL1", name: "Algodão", cycle: "Safrinha" },
  { code: "MI1", name: "Milho", cycle: "Safrinha" },
  { code: "CC1", name: "Capim", cycle: "Safrinha" },
];

function cn(...values: Array<string | false | undefined>) { return values.filter(Boolean).join(" "); }
function formatNumber(value: number) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value || 0); }
function formatCurrency(value: number, currency: CommercialCurrency) { return currency ? new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0) : `${formatNumber(value)} · moeda pendente`; }
function formatDose(value: number | null) { return value === null ? "n.a." : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function amountToDeliver(row: Pick<ReconciliationRow, "farmBalance" | "warehouseBalance" | "applied" | "transit" | "planned">) {
  return row.farmBalance + row.warehouseBalance + row.applied + row.transit - row.planned;
}
function amountToDeliverColor(value: number) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-rose-700";
  return "text-slate-950";
}
function percent(value: number, total: number) { return total ? Math.max(0, Math.min(100, value * 100 / total)) : 0; }
function rawPercent(value: number, total: number) { return total ? value * 100 / total : 0; }
function percentageText(value: number, total: number) { return total > 0 ? rawPercent(value, total).toFixed(1) + "%" : "n.a."; }
function signedNumber(value: number | null) { return value === null ? "n.a." : (value > 0 ? "+" : "") + formatNumber(value); }
function dateKey(date: Date) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"); }
function monthKey(date: Date) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0")].join("-"); }
function formatMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month) ? new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" }).format(new Date(year, month - 1, 1)) : value;
}
function closingSupplierKey(supplier: string) {
  return normalizeMaterial(supplier) || supplier.trim().toLocaleUpperCase("pt-BR");
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}
function elapsedLabel(value?: string, now = Date.now()) {
  if (!value) return "Aguardando importação";
  const hours = Math.max(0, Math.floor((now - new Date(value).getTime()) / 3_600_000));
  const days = Math.floor(hours / 24);
  return days ? `há ${days} dia${days === 1 ? "" : "s"} e ${hours % 24} hora${hours % 24 === 1 ? "" : "s"}` : `há ${hours} hora${hours === 1 ? "" : "s"}`;
}
function freshnessStatus(value?: string, now = Date.now()) {
  if (!value) return { label: "Aguardando dados", tone: "slate" as const };
  const hours = Math.max(0, (now - new Date(value).getTime()) / 3_600_000);
  if (hours <= 12) return { label: "OK", tone: "emerald" as const };
  if (hours <= 48) return { label: "Em atenção", tone: "amber" as const };
  return { label: "Necessita atualizar", tone: "rose" as const };
}
function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
function daysFromToday(value: Date, now = new Date()) {
  return Math.round((startOfDay(value).getTime() - startOfDay(now).getTime()) / 86_400_000);
}
function pendingSignalStatus(daysUntil: number | null): Pick<PendingSignal, "status" | "tone"> {
  if (daysUntil === null) return { status: "Sem data", tone: "slate" };
  if (daysUntil <= -6) return { status: "Alerta", tone: "rose" };
  if (daysUntil <= -1) return { status: "Ponto de atenção", tone: "amber" };
  if (daysUntil <= 1) return { status: "Possível atraso", tone: "amber" };
  if (daysUntil <= 3) return { status: "Demanda próxima", tone: "sky" };
  return { status: "Programado", tone: "emerald" };
}
function taskId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function persistedTasks(value: unknown): TaskItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === "string") {
      return { id: `legada-${index}-${item}`, pendingId: "", title: item, createdAt: new Date().toISOString(), actions: [] };
    }
    const candidate = item as Partial<TaskItem>;
    return {
      id: candidate.id || `tarefa-${index}`,
      pendingId: candidate.pendingId || "",
      material: candidate.material || "",
      nucleus: candidate.nucleus || "",
      title: candidate.title || "Ação sem título",
      createdAt: candidate.createdAt || new Date().toISOString(),
      owner: candidate.owner || "Não atribuído",
      dueDate: candidate.dueDate || "",
      evidence: candidate.evidence || "",
      status: candidate.status === "Concluída" || candidate.status === "Em andamento" || candidate.status === "Aguardando" ? candidate.status : "Aberta",
      updatedAt: candidate.updatedAt || candidate.createdAt || new Date().toISOString(),
      actions: Array.isArray(candidate.actions) ? candidate.actions.filter((action): action is TaskAction => Boolean(action?.note)).map((action, actionIndex) => ({
        id: action.id || `acao-${index}-${actionIndex}`,
        note: action.note,
        createdAt: action.createdAt || new Date().toISOString(),
      })) : [],
    };
  });
}

function openWorkspaceDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(workspaceDatabase, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(workspaceStore)) request.result.createObjectStore(workspaceStore);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function loadWorkspace() {
  const database = await openWorkspaceDatabase();
  return new Promise<PersistedWorkspace | null>((resolve, reject) => {
    const request = database.transaction(workspaceStore, "readonly").objectStore(workspaceStore).get(workspaceRecord);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve((request.result as PersistedWorkspace | undefined) || null);
  }).finally(() => database.close());
}
async function saveWorkspace(workspace: PersistedWorkspace) {
  const database = await openWorkspaceDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(workspaceStore, "readwrite");
    transaction.objectStore(workspaceStore).put(workspace, workspaceRecord);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  }).finally(() => database.close());
}
function localWorkspaceSnapshot(workspace: PersistedWorkspace): PersistedWorkspace {
  // A fonte operacional é central. Manter planilhas completas no IndexedDB
  // duplicava dezenas de MB e podia travar a aba depois de uma importação.
  // Localmente ficam apenas configurações, dimensões e histórico de tarefas.
  return { ...workspace, datasets: { ...emptyDatasets } };
}

function bytesToBase64(bytes: Uint8Array) {
  let output = "";
  for (let index = 0; index < bytes.length; index += 0x8000) output += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return window.btoa(output);
}
function workspaceCodec<T>(action: "decode" | "encode", value: unknown) {
  if (typeof Worker === "undefined") return Promise.reject(new Error("Worker indisponível"));
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL("../workers/workspace-codec.worker.ts", import.meta.url), { type: "module" });
    const id = `workspace-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cleanup = () => worker.terminate();
    worker.onerror = () => { cleanup(); reject(new Error("Não foi possível processar a base central em segundo plano.")); };
    worker.onmessage = ({ data }: MessageEvent<{ error?: string; id: string; value?: T }>) => {
      if (data.id !== id) return;
      cleanup();
      if (data.error) { reject(new Error(data.error)); return; }
      resolve(data.value as T);
    };
    worker.postMessage({ action, id, value });
  });
}
async function encodeRemoteWorkspace(workspace: PersistedWorkspace) {
  try {
    return await workspaceCodec<{ encoding: "gzip-base64" | "json"; data: unknown }>("encode", workspace);
  } catch {
    const bytes = new TextEncoder().encode(JSON.stringify(workspace));
    if (!("CompressionStream" in window)) return { encoding: "json", data: workspace };
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return { encoding: "gzip-base64", data: bytesToBase64(compressed) };
  }
}
async function decodeRemoteWorkspace(payload: unknown): Promise<PersistedWorkspace | null> {
  if (!payload || typeof payload !== "object") return null;
  const stored = payload as { encoding?: string; data?: unknown };
  try {
    return await workspaceCodec<PersistedWorkspace | null>("decode", stored);
  } catch {
    if (stored.encoding === "json") return stored.data as PersistedWorkspace;
    if (stored.encoding !== "gzip-base64" || typeof stored.data !== "string" || !("DecompressionStream" in window)) return null;
    const stream = new Blob([base64ToBytes(stored.data)]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text()) as PersistedWorkspace;
  }
}

function dateFromPlan(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value ?? "").trim();
  const serial = Number(raw.replace(",", "."));
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    // Excel conta dias desde 30/12/1899. A conversão local evita carregar a
    // biblioteca de planilhas apenas para interpretar uma data de planejamento.
    const date = new Date(1899, 11, 30);
    date.setDate(date.getDate() + Math.floor(serial));
    return date;
  }
  const match = /^(\d{1,2})[/.\\-](\d{1,2})[/.\\-](\d{2,4})$/.exec(raw);
  if (match) {
    const year = Number(match[3].length === 2 ? "20" + match[3] : match[3]);
    return new Date(year, Number(match[2]) - 1, Number(match[1]));
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function parseImportFile(file: File, source: Pick<(typeof sourceConfig)[number], "key" | "header">) {
  const buffer = await file.arrayBuffer();
  return new Promise<{ rows: Row[]; rowCount: number; sheets: string[] }>((resolve, reject) => {
    const worker = new Worker(new URL("../workers/import-worker.ts", import.meta.url), { type: "module" });
    const id = `${source.key}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cleanup = () => worker.terminate();
    worker.onerror = () => { cleanup(); reject(new Error(`Não foi possível processar ${file.name}.`)); };
    worker.onmessage = ({ data }: MessageEvent<{ error?: string; id: string; rowCount?: number; rows?: Row[]; sheets?: string[] }>) => {
      if (data.id !== id) return;
      cleanup();
      if (data.error || !data.rows) { reject(new Error(data.error || `Não foi possível processar ${file.name}.`)); return; }
      resolve({ rows: data.rows, rowCount: data.rowCount || data.rows.length, sheets: data.sheets || [] });
    };
    worker.postMessage({ buffer, header: source.header, id, key: source.key }, [buffer]);
  });
}
function importWarnings(rows: Row[], source: SourceKey) {
  const materialRequired = source !== "planejamento" && source !== "execucao";
  let missingMaterial = 0;
  let missingQuantity = 0;
  rows.forEach((row) => {
    const material = readText(row, "Produto", "Texto breve material", "Descrição Material", "Descricao Material", "Descrição Produto", "Descricao Produto", "Texto material");
    const quantity = readText(row, "Quantidade", "Qt. Solicitada", "Qt Solicitada", "Saldo", "Util.livre", "Saldo Forn", "Qtd.pedido", "Qtde. talhão", "Qtd.retirada");
    if (materialRequired && !material) missingMaterial += 1;
    if (material && !quantity) missingQuantity += 1;
  });
  return { missingMaterial, missingQuantity, total: missingMaterial + missingQuantity };
}
function statusExcluded(row: Row, status: string) {
  return headerKey(readText(row, "Status", "Situação", "Situacao")) === headerKey(status);
}
function planningProduct(row: Row, excluded: string) {
  if (statusExcluded(row, excluded)) return false;
  const classification = readText(row, "Classificação", "Classificacao", "Classificac�o", "Tipo");
  return !classification || headerKey(classification).includes("PRODUTO");
}

function mergePremises(bundle: DimensionBundle, items: DimensionPremise[]): DimensionBundle {
  const materials = { ...bundle.materials };
  const centerToNucleus = { ...bundle.centerToNucleus };
  const cultureToCycle = { ...bundle.cultureToCycle };
  const conversions = { ...bundle.conversions };
  items.forEach((item) => {
    const domain = headerKey(item.domain);
    const key = normalizeMaterial(item.key);
    const value = item.value.trim();
    if (!key || !value) return;
    if (domain === "MATERIAL") {
      const existing = materials[key];
      materials[key] = {
        material: item.key.trim(), aggregateMaterial: value,
        principleActive: existing?.principleActive || "Não informado",
        merchandiseGroup: existing?.merchandiseGroup || "Sem grupo",
        subgroup: existing?.subgroup || "Sem subgrupo",
        target: existing?.target || "",
        standardDose: existing?.standardDose || 0,
      };
    } else if (domain === "PRINCIPIOATIVO") {
      const existing = materials[key];
      materials[key] = {
        material: existing?.material || item.key.trim(),
        aggregateMaterial: existing?.aggregateMaterial || item.key.trim(),
        principleActive: value, merchandiseGroup: existing?.merchandiseGroup || "Sem grupo",
        subgroup: existing?.subgroup || "Sem subgrupo",
        target: existing?.target || "",
        standardDose: existing?.standardDose || 0,
      };
    } else if (domain === "CENTRO" || domain === "FAZENDA" || domain === "NUCLEO") {
      centerToNucleus[key] = value;
    } else if (domain === "CULTURA") {
      cultureToCycle[key] = value;
    } else if (domain === "CONVERSAO" || domain === "CONVERSAODEDOSE") {
      const pair = item.key.split("|").map(normalizeMaterial);
      const factor = numberFrom(value);
      if (pair[0] && pair[1] && factor > 0) conversions[pair[0] + "|" + pair[1]] = factor;
    }
  });
  return { materials, centerToNucleus, cultureToCycle, conversions };
}

function Card({ label, value, note, tone = "slate" }: { label: string; value: ReactNode; note?: ReactNode; tone?: "slate" | "amber" | "rose" | "emerald" }) {
  const color = { slate: "border-slate-200 bg-white", amber: "border-amber-200 bg-amber-50/70", rose: "border-rose-200 bg-rose-50/70", emerald: "border-emerald-200 bg-emerald-50/70" }[tone];
  return <div className={cn("metric-card rounded-2xl border p-4", color)}><p className="text-xs font-semibold text-slate-600">{label}</p><p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p>{note ? <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{note}</p> : null}</div>;
}
function Progress({ value }: { value: number }) {
  return <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: String(Math.max(0, Math.min(100, value))) + "%" }} /></div>;
}
function Table({ headers, rows, empty = "Nenhum dado no recorte." }: { headers: string[]; rows: ReactNode[][]; empty?: string }) {
  return <div className="data-table overflow-x-auto border-y border-slate-200"><table className="w-full min-w-max text-left text-sm"><thead className="bg-emerald-950 text-[11px] uppercase tracking-wide text-emerald-100"><tr>{headers.map((head) => <th className="whitespace-nowrap px-3 py-3 font-semibold" key={head}>{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-200 bg-white">{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td className="px-3 py-3 align-top" key={cellIndex}>{cell}</td>)}</tr>) : <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={headers.length}>{empty}</td></tr>}</tbody></table></div>;
}
function Empty({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return <div className="empty-state grid min-h-[280px] place-items-center rounded-2xl border border-dashed border-emerald-200 bg-white p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-950 text-emerald-100"><PackageSearch className="h-6 w-6" /></div><h2 className="mt-5 text-xl font-bold tracking-tight">{title}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-600">{description}</p>{actionLabel && onAction ? <button className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700" onClick={onAction} type="button"><FileUp className="h-4 w-4" />{actionLabel}</button> : null}</div></div>;
}
function ContentLoading({ detail = "Lendo arquivos, conciliando materiais e atualizando os visuais." }: { detail?: string }) {
  return <section aria-busy="true" aria-live="polite" className="content-loading grid min-h-[min(68vh,620px)] place-items-center rounded-3xl p-5" role="status"><div className="content-loading-card w-full max-w-sm rounded-3xl p-8 text-center shadow-2xl"><div aria-hidden="true" className="pacman-scene mx-auto"><svg className="pacman-loader" viewBox="0 0 64 64"><path className="pacman-jaw-upper" d="M4 32 A28 28 0 0 1 60 32 Z" /><path className="pacman-jaw-lower" d="M60 32 A28 28 0 0 1 4 32 Z" /></svg><span className="pacman-dot pacman-dot-one" /><span className="pacman-dot pacman-dot-two" /><span className="pacman-dot pacman-dot-three" /></div><p className="mt-7 text-[11px] font-bold uppercase tracking-[.18em] text-emerald-300">AgroNexus 360°</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-white">Carregando conteúdo</h2><p className="mt-3 text-sm leading-relaxed text-emerald-100">{detail}</p></div></section>;
}
function LoginScreen({ error, loading, onPasswordChange, onSubmit, onUsernameChange, password, username }: { error: string; loading: boolean; onPasswordChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onUsernameChange: (value: string) => void; password: string; username: string }) {
  return <main className="login-screen grid min-h-screen place-items-center p-5"><form className="login-card w-full max-w-md rounded-3xl p-7 shadow-2xl sm:p-9" onSubmit={onSubmit}><div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-300 text-emerald-950"><Sprout className="h-6 w-6" /></div><p className="mt-7 text-[11px] font-bold uppercase tracking-[.18em] text-emerald-300">Planejamento agrícola 360°</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Bem-vindo ao AgroNexus</h1><p className="mt-3 text-sm leading-relaxed text-emerald-100">Entre para acessar a base central de planejamento, insumos e tarefas.</p><div className="mt-7 grid gap-4"><label className="grid gap-1.5 text-sm font-semibold text-emerald-50">Login<input autoComplete="username" className="rounded-xl border border-emerald-700/80 bg-emerald-950/50 px-3 py-3 text-base font-normal text-white outline-none placeholder:text-emerald-200/50 focus:border-emerald-300" onChange={(event) => onUsernameChange(event.target.value)} placeholder="seu.login" required value={username} /></label><label className="grid gap-1.5 text-sm font-semibold text-emerald-50">Senha<input autoComplete="current-password" className="rounded-xl border border-emerald-700/80 bg-emerald-950/50 px-3 py-3 text-base font-normal text-white outline-none placeholder:text-emerald-200/50 focus:border-emerald-300" onChange={(event) => onPasswordChange(event.target.value)} placeholder="Sua senha" required type="password" value={password} /></label>{error ? <p className="rounded-xl border border-rose-400/30 bg-rose-950/30 px-3 py-2 text-sm text-rose-100">{error}</p> : null}<button className="mt-2 rounded-xl bg-emerald-300 px-4 py-3 text-sm font-bold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-70" disabled={loading} type="submit">{loading ? "Entrando..." : "Entrar na plataforma"}</button></div><p className="mt-6 text-center text-xs leading-relaxed text-emerald-200/80">A carga operacional, as tarefas e os históricos são protegidos em uma base central.</p></form></main>;
}
function Navigation({ active, alertCount, lastUpdatedAt, onSelect }: { active: string; alertCount: number; lastUpdatedAt?: string; onSelect: (value: string) => void }) {
  return <aside className="command-sidebar fixed inset-y-0 left-0 z-20 hidden w-[264px] flex-col border-r border-emerald-950 bg-emerald-950 px-4 py-5 text-emerald-50 lg:flex"><div className="px-3 pb-6"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-300 text-emerald-950"><Sprout className="h-5 w-5" /></div><div><p className="text-sm font-bold tracking-tight">AgroNexus</p><p className="text-[10px] font-semibold tracking-[.12em] text-emerald-300">PLANEJAMENTO 360°</p></div></div><div className="mt-5 border-t border-emerald-800 pt-4"><p className="text-[10px] font-semibold tracking-[.1em] text-emerald-300">BASE OPERACIONAL</p><p className="mt-1 text-xs font-semibold text-emerald-50">{lastUpdatedAt ? `Atualizada ${formatDateTime(lastUpdatedAt)}` : "Aguardando primeira importação"}</p></div></div><div className="min-h-0 flex-1 overflow-y-auto pr-1"><p className="px-3 pb-2 text-[10px] font-bold tracking-[.12em] text-emerald-300">ANÁLISE</p><div className="space-y-1">{nav.map(([label, Icon], index) => <Fragment key={label}>{index === 4 ? <p className="px-3 pb-2 pt-6 text-[10px] font-bold tracking-[.12em] text-emerald-300">GESTÃO</p> : null}<button className={cn("flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition", active === label ? "bg-emerald-300 text-emerald-950 shadow-sm" : "text-emerald-100 hover:bg-emerald-900")} onClick={() => onSelect(label)} type="button"><span className="flex items-center gap-3"><Icon className="h-4 w-4" />{label}</span>{label === "Alertas" && alertCount ? <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">{alertCount > 99 ? "99+" : alertCount}</span> : null}</button></Fragment>)}</div></div><div className="mt-5 rounded-2xl border border-emerald-800 bg-emerald-900/70 p-4"><ShieldCheck className="h-5 w-5 text-emerald-300" /><p className="mt-3 text-xs font-bold text-white">Conciliação pelo material</p><p className="mt-1 text-[11px] leading-relaxed text-emerald-100">A decisão usa o nome do material; códigos SAP servem somente ao diagnóstico.</p></div></aside>;
}

type AnalysisFiltersProps = {
  cultures: string[];
  cultureFilter: string;
  cycleFilter: string;
  cycles: string[];
  groupFilter: string;
  groups: string[];
  onCultureChange: (value: string) => void;
  onCycleChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onNucleusChange?: (value: string) => void;
  onQueryChange: (value: string) => void;
  onSubgroupChange: (value: string) => void;
  nuclei?: string[];
  nucleusFilter?: string;
  query: string;
  subgroupFilter: string;
  subgroups: string[];
};

function AnalysisFilters({
  cultures, cultureFilter, cycleFilter, cycles, groupFilter, groups,
  onCultureChange, onCycleChange, onGroupChange, onNucleusChange, onQueryChange, onSubgroupChange,
  nuclei, nucleusFilter, query, subgroupFilter, subgroups,
}: AnalysisFiltersProps) {
  return <div className={cn("filter-bar grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-2", nuclei ? "xl:grid-cols-6" : "xl:grid-cols-5")}>
    <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">Ciclo
      <select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => onCycleChange(event.target.value)} value={cycleFilter}>
        {cycles.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label>
    <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">Grupo
      <select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => onGroupChange(event.target.value)} value={groupFilter}>
        {groups.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label>
    <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">Subgrupo
      <select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => onSubgroupChange(event.target.value)} value={subgroupFilter}>
        {subgroups.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label>
    <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">Cultura
      <select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => onCultureChange(event.target.value)} value={cultureFilter}>
        {cultures.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label>
    {nuclei && nucleusFilter !== undefined && onNucleusChange ? <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">Núcleo
      <select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => onNucleusChange(event.target.value)} value={nucleusFilter}>
        {nuclei.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label> : null}
    <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">Buscar
      <span className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" /><input className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-sm font-normal" onChange={(event) => onQueryChange(event.target.value)} placeholder="Produto ou princípio ativo" value={query} /></span>
    </label>
  </div>;
}

type DemandRow = ReconciliationRow & { demand: number; local: number };
type WarehouseAllocation = { allocated: number; locations: ReconciliationRow["locations"] };
type MonitoringRow = ReconciliationRow & { isWarehouseView?: boolean };
type PhysicalStockBalance = { converted: number; physical: number; hasConversion: boolean };
type MonitoringGroup = {
  active: string;
  rows: MonitoringRow[];
  totals: {
    applied: number;
    balance: number;
    pendingOrder: number;
    planned: number;
    toDeliver: number;
    transit: number;
  };
};
type PerformanceAccumulator = {
  active: string;
  appliedArea: number;
  appliedVolume: number;
  canonicalKey: string;
  cultures: Set<string>;
  cycles: Set<string>;
  merchandiseGroup: string;
  neededVolume: number;
  nucleus: string;
  plannedArea: number;
  plannedVolume: number;
  standardMaterial: string;
  subgroup: string;
};

function taskPart(value: unknown) {
  const raw = String(value ?? "").trim();
  return raw.replace(/^0+(?=\d)/, "");
}

function taskKey(row: Row) {
  const diagram = taskPart(readText(row, "DiagRede", "Diagrama"));
  const operation = taskPart(readText(row, "Tar.", "Operação", "Operacao"));
  return diagram ? [diagram, operation].join("|") : "";
}

function planningArea(row: Row) {
  return readNumber(row, "Área executar (HA)", "Area executar (HA)", "HA_plantio", "HA plantio", "HA_talhao", "HA talhão");
}
function isPlantingWithoutFertilizer(row: Row, excludedStatus: string) {
  if (statusExcluded(row, excludedStatus)) return false;
  const classification = headerKey(readText(row, "Classificação", "Classificacao", "Classificac�o", "Tipo"));
  const activity = headerKey(readText(row, "Atividade", "Operação", "Operacao", "Operações", "Operacoes", "Descr. Operação", "Descr Operação", "Tar."));
  return classification.includes("ATIVIDADE") && activity.includes("PLANTIOSEMADUBO");
}

/**
 * Rateia o estoque central apenas uma vez para cada material agregado. Sem
 * isso, o mesmo saldo 0714 poderia atender vários núcleos simultaneamente.
 */
function allocateCentralWarehouse(rows: DemandRow[], stockRows: ReconciliationRow[] = rows) {
  const pools = new Map<string, { amount: number; locations: ReconciliationRow["locations"] }>();
  stockRows.forEach((row) => row.locations.filter((location) => location.type === "Armazém").forEach((location) => {
    const pool = pools.get(row.canonicalKey) || { amount: 0, locations: [] };
    pool.amount += location.amount;
    pool.locations.push({ ...location });
    pools.set(row.canonicalKey, pool);
  }));
  const totalAvailable = [...pools.values()].reduce((sum, pool) => sum + pool.amount, 0);
  const allocations = new Map<string, WarehouseAllocation>();
  [...rows]
    .sort((left, right) => left.canonicalKey.localeCompare(right.canonicalKey)
      || (right.demand - right.local) - (left.demand - left.local)
      || left.nucleus.localeCompare(right.nucleus))
    .forEach((row) => {
      const pool = pools.get(row.canonicalKey);
      let remaining = Math.max(0, row.demand - row.local);
      let allocated = 0;
      const locations: ReconciliationRow["locations"] = [];
      if (pool) {
        for (const location of pool.locations) {
          if (!remaining) break;
          const used = Math.min(remaining, location.amount);
          if (!used) continue;
          location.amount -= used;
          remaining -= used;
          allocated += used;
          locations.push({ ...location, amount: used });
        }
      }
      allocations.set(row.id, { allocated, locations });
    });
  return { allocations, totalAvailable };
}

function consolidateLocations(locations: ReconciliationRow["locations"]) {
  const consolidated = new Map<string, ReconciliationRow["locations"][number]>();
  locations.forEach((location) => {
    const key = [location.type, location.material, location.location].join("\u0000");
    const current = consolidated.get(key);
    consolidated.set(key, current ? { ...current, amount: current.amount + location.amount } : { ...location });
  });
  return [...consolidated.values()].sort((left, right) => left.location.localeCompare(right.location) || left.type.localeCompare(right.type));
}

// Para o aviso, lote e apresentação física não devem fragmentar o saldo:
// a decisão de repasse é feita pelo total disponível em cada armazém.
function consolidateWarehouseBalances(locations: ReconciliationRow["locations"]) {
  const consolidated = new Map<string, ReconciliationRow["locations"][number]>();
  locations.filter((location) => location.type === "Armazém" && location.amount > 0).forEach((location) => {
    const key = normalizeMaterial(location.location);
    const current = consolidated.get(key);
    consolidated.set(key, current ? { ...current, amount: current.amount + location.amount } : { ...location });
  });
  return [...consolidated.values()].sort((left, right) => left.location.localeCompare(right.location));
}

/**
 * Saldo transferível é uma sugestão: só considera o que sobra na fazenda de
 * outro núcleo depois da demanda da própria janela, sem prometer o mesmo saldo
 * para duas solicitações. O armazém continua sendo a primeira alternativa.
 */
function supportFromOtherNuclei(row: DemandRow, demands: DemandRow[]) {
  const locations = demands
    .filter((candidate) => candidate.canonicalKey === row.canonicalKey && candidate.nucleus !== row.nucleus)
    .flatMap((candidate) => {
      const transferable = Math.max(0, Math.min(candidate.farmBalance, candidate.local - candidate.demand));
      if (!transferable || !candidate.farmBalance) return [];
      const factor = transferable / candidate.farmBalance;
      return candidate.locations
        .filter((location) => location.type === "Fazenda" && location.amount > 0)
        .map((location) => ({
          ...location,
          amount: location.amount * factor,
          location: `Apoio sugerido — ${candidate.nucleus} — ${location.location}`,
        }));
    });
  return consolidateLocations(locations);
}

function stockDetailKey(rowId: string, location: ReconciliationRow["locations"][number]) {
  return [rowId, normalizeMaterial(location.material), location.type, location.location].join("\u0000");
}

function StockDetails({ row, physicalBalances }: { row: MonitoringRow; physicalBalances: Map<string, PhysicalStockBalance> }) {
  const groups = new Map<string, { balance: number; locations: ReconciliationRow["locations"]; transit: number }>();
  row.locations.forEach((location) => {
    const current = groups.get(location.material) || { balance: 0, locations: [], transit: 0 };
    if (location.type === "Trânsito") current.transit += location.amount;
    else current.balance += location.amount;
    current.locations.push(location);
    groups.set(location.material, current);
  });
  const materials = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  return <div className="overflow-x-auto rounded-xl border border-emerald-100 bg-white">
    <table className="w-full min-w-[980px] text-left text-xs">
      <thead className="bg-emerald-50 text-[10px] uppercase tracking-wide text-emerald-900">
        <tr>{["Nível", "Material", "Saldo", "Trânsito", "Aplicado", "A entregar", "V. solicitado", "Localização"].map((head) => <th className="px-3 py-2 font-semibold" key={head}>{head}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-emerald-50">
        {materials.flatMap(([material, detail]) => {
          // A ZMM_BATCH possui uma linha por lote. A visão operacional soma os
          // lotes quando material, tipo de saldo e localização são os mesmos.
          const locations = consolidateLocations(detail.locations);
          const locationBalances = locations.map((location) => ({ location, balance: physicalBalances.get(stockDetailKey(row.id, location)) }));
          const hasConversion = locationBalances.some(({ balance }) => balance?.hasConversion);
          const physicalBalance = locationBalances.reduce((sum, { location, balance }) => sum + (location.type === "Trânsito" ? 0 : balance?.physical || 0), 0);
          return [
            <tr className="bg-emerald-50/40" key={"material|" + material}><td className="px-3 py-2 font-semibold">Material<br /><span className={cn("text-[10px]", hasConversion ? "text-emerald-800" : "text-slate-500")}>{hasConversion ? "Com conversão" : "Sem conversão"}</span></td><td className="px-3 py-2 font-semibold">{material}</td><td className="px-3 py-2">{formatNumber(detail.balance)}{hasConversion ? <span className="mt-1 block text-[10px] font-semibold text-emerald-800">Físico: {formatNumber(physicalBalance)}</span> : null}</td><td className="px-3 py-2">{formatNumber(detail.transit)}</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-500">{row.isWarehouseView ? "Estoque de armazém" : "Estoque do núcleo"}</td></tr>,
            ...locationBalances.map(({ location, balance }) => <tr key={["location", material, location.type, location.location].join("|")}><td className="px-3 py-2 pl-7 text-slate-500">↳ Local{balance?.hasConversion ? <span className="block text-[10px] font-semibold text-emerald-800">Convertido</span> : null}</td><td className="px-3 py-2">{location.material}</td><td className="px-3 py-2">{location.type === "Trânsito" ? "—" : <>{formatNumber(location.amount)}{balance?.hasConversion ? <span className="mt-1 block text-[10px] font-semibold text-emerald-800">Físico: {formatNumber(balance.physical)}</span> : null}</>}</td><td className="px-3 py-2">{location.type === "Trânsito" ? formatNumber(location.amount) : "—"}</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-600">{location.location}</td></tr>),
          ];
        })}
        {!materials.length ? <tr><td className="px-3 py-5 text-center text-slate-500" colSpan={8}>Não há saldo ou trânsito detalhado para este material.</td></tr> : null}
      </tbody>
    </table>
  </div>;
}

export default function Home() {
  const [active, setActive] = useState("Visão geral");
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [datasets, setDatasets] = useState<Datasets>(emptyDatasets);
  const [uploads, setUploads] = useState<Partial<Record<SourceKey, File>>>({});
  const [imports, setImports] = useState<Partial<Record<ImportKey, ImportSummary>>>({});
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [bundle, setBundle] = useState<DimensionBundle>(emptyDimensionBundle);
  const [premises, setPremises] = useState<Premises>(initialPremises);
  const [emailSettings, setEmailSettings] = useState<EmailSettings>(initialEmailSettings);
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings>(initialDashboardSettings);
  const [dimensionPremises, setDimensionPremises] = useState<DimensionPremise[]>([]);
  const [draft, setDraft] = useState<DimensionPremise>({ domain: "Material", key: "", value: "" });
  const [showPremises, setShowPremises] = useState(false);
  const [premiseSection, setPremiseSection] = useState<PremiseSection["id"]>("operacionais");
  const [showProvision, setShowProvision] = useState(false);
  const [dark, setDark] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("agronexus-theme") === "dark");
  const [cycleFilter, setCycleFilter] = useState("Safra");
  const [groupFilter, setGroupFilter] = useState("Todos");
  const [subgroupFilter, setSubgroupFilter] = useState("Todos");
  const [cultureFilter, setCultureFilter] = useState("Todos");
  const [nucleusFilter, setNucleusFilter] = useState("Todos");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [taskPendingId, setTaskPendingId] = useState("");
  const [taskLinkMode, setTaskLinkMode] = useState<"pedido" | "material">("pedido");
  const [taskMaterialLink, setTaskMaterialLink] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskNote, setTaskNote] = useState("");
  const [taskActionDrafts, setTaskActionDrafts] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [logistics, setLogistics] = useState<LogisticsState>(initialLogistics);
  const [commercialClosings, setCommercialClosings] = useState<CommercialClosingsState>(initialCommercialClosings);
  const [closingTab, setClosingTab] = useState<"calendario" | "painel" | "distribuicoes" | "anotacoes">("calendario");
  const [closingDraft, setClosingDraft] = useState({
    supplier: "", paymentDue: "", destination: "", deliveryLocation: "", cycle: "Safra" as CommercialClosing["cycle"],
    culture: "", active: "", product: "", unit: "", currency: "BRL" as CommercialClosing["currency"], unitPrice: "", packaging: "", totalVolume: "", orderKey: "",
  });
  const [closingDistributionDraft, setClosingDistributionDraft] = useState<ClosingDistribution>({});
  const [editingClosingId, setEditingClosingId] = useState("");
  const [closingAnnotationDraft, setClosingAnnotationDraft] = useState({ closingId: "", materialSent: "", purchaseVolume: "", invoicedVolume: "", note: "", resolved: false });
  const [closingCycleFilter, setClosingCycleFilter] = useState("Todos");
  const [closingSupplierFilter, setClosingSupplierFilter] = useState<string | null>(null);
  const [closingCalendarPeriod, setClosingCalendarPeriod] = useState<ClosingCalendarPeriod>();
  const [closingQuery, setClosingQuery] = useState("");
  const [closingMessage, setClosingMessage] = useState("");
  const [logisticsTab, setLogisticsTab] = useState<"emissao" | "viagens" | "rodoviaria">("emissao");
  const [driverDraft, setDriverDraft] = useState({ cpf: "", fullName: "", phone: "" });
  const [vehicleDraft, setVehicleDraft] = useState({ capacity: "", model: "", plate: "" });
  const [tripRequestId, setTripRequestId] = useState("");
  const [tripMaterialKey, setTripMaterialKey] = useState("");
  const [routeItems, setRouteItems] = useState<LogisticsTripItem[]>([]);
  const [tripDriverId, setTripDriverId] = useState("");
  const [tripVehicleId, setTripVehicleId] = useState("");
  const [tripInvoiceNumber, setTripInvoiceNumber] = useState("");
  const [recipeTripId, setRecipeTripId] = useState("");
  const [recipeDraft, setRecipeDraft] = useState<TripRecipe>({ culture: "", dose: "", target: "" });
  const [logisticsMessage, setLogisticsMessage] = useState("");
  const [taskHistorySize, setTaskHistorySize] = useState(10);
  const [taskHistoryPage, setTaskHistoryPage] = useState(0);
  const [taskSignalFilter, setTaskSignalFilter] = useState("Todos");
  const [taskOrderFilter, setTaskOrderFilter] = useState("Todos");
  const [taskNucleusFilter, setTaskNucleusFilter] = useState("Todos");
  const [taskMaterialFilter, setTaskMaterialFilter] = useState("");
  const [alertNucleusFilter, setAlertNucleusFilter] = useState("Todos");
  const [alertMaterialFilter, setAlertMaterialFilter] = useState("");
  const [alertGroupFilter, setAlertGroupFilter] = useState("Todos");
  const [alertSubgroupFilter, setAlertSubgroupFilter] = useState("Todos");
  const [showNotification, setShowNotification] = useState(false);
  const [notificationNucleus, setNotificationNucleus] = useState("Todos");
  const [notificationDays, setNotificationDays] = useState("7");
  const [notificationTo, setNotificationTo] = useState("");
  const [notificationCc, setNotificationCc] = useState("");
  const [notificationMessage, setNotificationMessage] = useState<{ text: string; success?: boolean } | null>(null);
  const [notificationSource, setNotificationSource] = useState<{ name: string; rows: Row[] } | null>(null);
  const [notificationSourceLoading, setNotificationSourceLoading] = useState(false);
  const notificationSourceRequest = useRef(0);
  const [settingsTab, setSettingsTab] = useState<"premissas" | "email">("premissas");
  const [storageReady, setStorageReady] = useState(false);
  const [persistenceError, setPersistenceError] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [userDraft, setUserDraft] = useState<UserDraft>(emptyUserDraft);
  const [userManagerLoading, setUserManagerLoading] = useState(false);
  const [userManagerMessage, setUserManagerMessage] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [evaluationDate, setEvaluationDate] = useState(() => dateKey(new Date()));
  const [provisionUntil, setProvisionUntil] = useState(() => {
    const end = new Date();
    end.setDate(end.getDate() + 15);
    return dateKey(end);
  });
  // Perfis operacionais nunca podem cair no consolidado por ausência de cadastro.
  // O valor sentinela não existe em nenhuma fonte e, portanto, resulta em visão vazia
  // até que o administrador defina o núcleo do usuário.
  const isOperator = Boolean(currentUser && currentUser.role !== "admin");
  const operatorNucleus = isOperator ? currentUser?.nucleus?.trim() || "__NUCLEO_NAO_DEFINIDO__" : "";
  const operatorHasNucleus = !isOperator || operatorNucleus !== "__NUCLEO_NAO_DEFINIDO__";

  function applyWorkspace(workspace: PersistedWorkspace | null) {
    if (!workspace) return;
    setBundle(workspace.bundle || emptyDimensionBundle);
    setDatasets({ ...emptyDatasets, ...(workspace.datasets || {}) });
    setDimensionPremises(workspace.dimensionPremises || []);
    setImports(workspace.imports || {});
    setImportHistory(workspace.importHistory || []);
    setAuditEvents(workspace.auditEvents || []);
    setPremises({ ...initialPremises, ...(workspace.premises || {}) });
    setEmailSettings({ ...initialEmailSettings, ...(workspace.emailSettings || {}), nucleusRecipients: workspace.emailSettings?.nucleusRecipients || {} });
    setDashboardSettings({ ...initialDashboardSettings, ...(workspace.dashboardSettings || {}) });
    setTasks(persistedTasks(workspace.tasks));
    setLogistics({ ...initialLogistics, ...(workspace.logistics || {}), drivers: workspace.logistics?.drivers || [], trips: workspace.logistics?.trips || [], vehicles: workspace.logistics?.vehicles || [] });
    setCommercialClosings({ ...initialCommercialClosings, ...(workspace.commercialClosings || {}), annotations: workspace.commercialClosings?.annotations || [], closings: workspace.commercialClosings?.closings || [] });
  }

  function recordAudit(kind: AuditEvent["kind"], detail: string) {
    const actor = currentUser?.name || "Sistema";
    setAuditEvents((current) => [{ id: taskId("audit"), actor, detail, kind, createdAt: new Date().toISOString() }, ...current].slice(0, 120));
  }

  async function hydrateCentralWorkspace() {
    const response = await fetch("/api/workspace", { credentials: "include" });
    if (!response.ok) throw new Error("Não foi possível recuperar a carga central.");
    const result = await response.json() as { workspace?: unknown };
    const central = await decodeRemoteWorkspace(result.workspace);
    const workspace = central || await loadWorkspace();
    applyWorkspace(workspace);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth", { credentials: "include" });
        if (!response.ok) throw new Error("Não foi possível validar a sessão.");
        const result = await response.json() as { user?: AppUser | null };
        if (result.user) {
          setCurrentUser(result.user);
          await hydrateCentralWorkspace();
        }
      } catch (error) {
        if (active) setPersistenceError(error instanceof Error ? error.message : "Não foi possível iniciar a base central.");
      } finally {
        if (active) { setStorageReady(true); setAuthReady(true); }
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!storageReady || !currentUser) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const payload = await encodeRemoteWorkspace({ bundle, datasets, dimensionPremises, imports, importHistory, auditEvents, premises, tasks, logistics, commercialClosings, emailSettings, dashboardSettings });
          const response = await fetch("/api/workspace", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload }) });
          if (!response.ok) throw new Error("Não foi possível salvar a carga central.");
          await saveWorkspace(localWorkspaceSnapshot({ bundle, datasets, dimensionPremises, imports, importHistory, auditEvents, premises, tasks, logistics, commercialClosings, emailSettings, dashboardSettings }));
        } catch (error) {
          setPersistenceError(error instanceof Error ? error.message : "Não foi possível salvar a carga central.");
        }
      })();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [auditEvents, bundle, commercialClosings, currentUser, dashboardSettings, datasets, dimensionPremises, emailSettings, importHistory, imports, logistics, premises, storageReady, tasks]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isOperator) return;
    // Operadores trabalham no próprio núcleo. Acompanhamento permanece geral
    // para preservar a comparação de materiais entre todos os núcleos.
    setNucleusFilter(active === "Acompanhamento" ? "Todos" : operatorNucleus);
    setAlertNucleusFilter(operatorNucleus);
    setTaskNucleusFilter(operatorNucleus);
  }, [active, isOperator, operatorNucleus]);

  const toggleTheme = () => setDark((current) => {
    window.localStorage.setItem("agronexus-theme", current ? "light" : "dark");
    return !current;
  });

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: loginUsername, password: loginPassword }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.user) throw new Error(result.error || "Não foi possível entrar.");
      setStorageReady(false);
      setCurrentUser(result.user as AppUser);
      await hydrateCentralWorkspace();
      setLoginPassword("");
      setStorageReady(true);
    } catch (error) {
      setCurrentUser(null);
      setLoginError(error instanceof Error ? error.message : "Não foi possível entrar.");
      setStorageReady(true);
    } finally {
      setLoggingIn(false);
    }
  }

  async function loadManagedUsers() {
    if (currentUser?.role !== "admin") return;
    setUserManagerLoading(true);
    try {
      const response = await fetch("/api/users", { credentials: "include" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível carregar os usuários.");
      setManagedUsers(Array.isArray(result.users) ? result.users : []);
    } catch (error) {
      setUserManagerMessage(error instanceof Error ? error.message : "Não foi possível carregar os usuários.");
    } finally {
      setUserManagerLoading(false);
    }
  }

  useEffect(() => {
    if (active === "Usuários" && currentUser?.role === "admin") void loadManagedUsers();
  }, [active, currentUser?.id, currentUser?.role]);

  async function saveManagedUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserManagerMessage("");
    if (!userDraft.id && !userDraft.password.trim()) {
      setUserManagerMessage("Informe uma senha para a nova conta.");
      return;
    }
    setUserManagerLoading(true);
    try {
      const response = await fetch("/api/users", {
        method: userDraft.id ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...userDraft, nucleus: userDraft.role === "admin" ? "" : userDraft.nucleus }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar o usuário.");
      setUserDraft(emptyUserDraft);
      setUserManagerMessage(userDraft.id ? "Usuário atualizado." : "Usuário criado.");
      await loadManagedUsers();
    } catch (error) {
      setUserManagerMessage(error instanceof Error ? error.message : "Não foi possível salvar o usuário.");
      setUserManagerLoading(false);
    }
  }

  function editManagedUser(user: ManagedUser) {
    setUserManagerMessage("");
    setUserDraft({ id: user.id, name: user.name, nucleus: user.nucleus || "", password: "", role: user.role === "admin" ? "admin" : "viewer", username: user.username });
  }

  async function removeManagedUser(user: ManagedUser) {
    if (!window.confirm(`Excluir a conta de ${user.name}? Esta ação não pode ser desfeita.`)) return;
    setUserManagerMessage("");
    setUserManagerLoading(true);
    try {
      const response = await fetch("/api/users", { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: user.id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível excluir o usuário.");
      if (userDraft.id === user.id) setUserDraft(emptyUserDraft);
      setUserManagerMessage("Usuário excluído.");
      await loadManagedUsers();
    } catch (error) {
      setUserManagerMessage(error instanceof Error ? error.message : "Não foi possível excluir o usuário.");
      setUserManagerLoading(false);
    }
  }

  const dimensions = useMemo(() => mergePremises(bundle, dimensionPremises), [bundle, dimensionPremises]);
  const pendingOrders = datasets.pedidos;
  const plans = useMemo(() => datasets.planejamento.filter((row) => planningProduct(row, premises.excludedStatus)), [datasets.planejamento, premises.excludedStatus]);
  const plantingAreaRows = useMemo(() => datasets.planejamento.filter((row) => isPlantingWithoutFertilizer(row, premises.excludedStatus)), [datasets.planejamento, premises.excludedStatus]);
  const farmToNucleus = useMemo(() => buildFarmToNucleus([...plans, ...datasets.execucao], dimensions, plans), [plans, datasets.execucao, dimensions]);
  const stockRows = useMemo(() => {
    // A BATCH é a fonte prioritária. A MB52 completa somente apresentações
    // físicas que não aparecem nela, evitando duplicar o mesmo saldo.
    const batchMaterials = new Set(datasets.estoque.map((row) => normalizeMaterial(productFor(row, "stock", dimensions).rawName)));
    const mb52Fallback = datasets.estoqueMb52.filter((row) => !batchMaterials.has(normalizeMaterial(productFor(row, "stock", dimensions).rawName)));
    return [...datasets.estoque, ...mb52Fallback];
  }, [datasets.estoque, datasets.estoqueMb52, dimensions]);
  const stockConversionBalances = useMemo(() => {
    const balances = new Map<string, { converted: number; physical: number; hasConversion: boolean }>();
    stockRows.forEach((row) => {
      const product = productFor(row, "stock", dimensions);
      if (product.rawName === "Sem descrição") return;
      const physical = quantityFor(row, "stock");
      if (!physical) return;
      const nucleus = stockNucleusFor(row, dimensions, farmToNucleus);
      const location = stockLocationFor(row, nucleus);
      const id = `${product.canonicalKey}|${normalizeMaterial(location.type === "Armazém" ? "ARMAZEM" : nucleus)}`;
      const converted = standardAmount(physical, product, dimensions);
      const current = balances.get(id) || { converted: 0, physical: 0, hasConversion: false };
      current.converted += converted;
      current.physical += physical;
      current.hasConversion ||= Math.abs(physical - converted) > 0.000_001;
      balances.set(id, current);
    });
    return balances;
  }, [dimensions, farmToNucleus, stockRows]);
  const stockLocationConversionBalances = useMemo(() => {
    const balances = new Map<string, PhysicalStockBalance>();
    stockRows.forEach((row) => {
      const product = productFor(row, "stock", dimensions);
      if (product.rawName === "Sem descrição") return;
      const physical = quantityFor(row, "stock");
      if (!physical) return;
      const nucleus = stockNucleusFor(row, dimensions, farmToNucleus);
      const stockLocation = stockLocationFor(row, nucleus);
      const rowId = `${product.canonicalKey}|${normalizeMaterial(stockLocation.type === "Armazém" ? "ARMAZEM" : nucleus)}`;
      const converted = standardAmount(physical, product, dimensions);
      const location = { amount: converted, location: stockLocation.place, material: product.rawName, type: stockLocation.type } as ReconciliationRow["locations"][number];
      const key = stockDetailKey(rowId, location);
      const current = balances.get(key) || { converted: 0, physical: 0, hasConversion: false };
      current.converted += converted;
      current.physical += physical;
      current.hasConversion ||= Math.abs(physical - converted) > 0.000_001;
      balances.set(key, current);
    });
    return balances;
  }, [dimensions, farmToNucleus, stockRows]);
  const ledger = useMemo(() => buildReconciliation({
    bundle: dimensions, planningRows: plans, stockRows, transitRows: datasets.transito,
    consumptionRows: datasets.consumo, pendingRows: pendingOrders, farmToNucleus,
  }), [dimensions, plans, stockRows, datasets.transito, datasets.consumo, pendingOrders, farmToNucleus]);

  const commercialOrders = useMemo(() => datasets.pedidosCompra
    .filter((row) => !["SIM", "S", "X", "TRUE"].includes(headerKey(readText(row, "Eliminado?", "Eliminado", "Cancelado"))))
    .map((row, index) => {
      const orderNumber = readText(row, "Doc.compra", "Documento de compra", "Pedido");
      const item = readText(row, "Item") || String(index + 1);
      const product = readText(row, "Descrição Material", "Descricao Material", "Produto");
      const dimension = dimensions.materials[normalizeMaterial(product)];
      return {
        key: `${orderNumber}|${item}|${normalizeMaterial(product)}`,
        orderNumber,
        item,
        product,
        standardProduct: dimension?.aggregateMaterial || product,
        active: dimension?.principleActive || "Não conciliado",
        supplier: readText(row, "Nome Fornecedor", "Fornecedor"),
        dueDate: readText(row, "Vencimento"),
        unit: readText(row, "UMP", "Unidade") || "—",
        currency: headerKey(readText(row, "Moeda")) === "USD" ? "USD" as const : "BRL" as const,
        unitPrice: readNumber(row, "Preco Brut", "Preço líq.", "Preco liq."),
        ordered: readNumber(row, "Qtd.pedido", "Qtd pedido", "Quantidade pedido"),
        supplied: readNumber(row, "Qtde. Forn", "Qtde. Fornecida", "Quantidade fornecida"),
        balance: readNumber(row, "Saldo Forn", "Saldo fornecer", "Saldo fornecedor"),
        center: readText(row, "Centro"),
        status: readText(row, "Código de", "Codigo de", "Status", "Aprovador(es)"),
      };
    })
    .filter((order) => Boolean(order.orderNumber && order.product)), [datasets.pedidosCompra, dimensions]);

  const commercialMaterialOptions = useMemo(() => {
    const entries = new Map<string, { active: string; product: string }>();
    Object.values(dimensions.materials).forEach((material) => {
      const product = material.aggregateMaterial || material.material;
      const key = normalizeMaterial(product);
      if (!entries.has(key)) entries.set(key, { active: material.principleActive, product });
    });
    return [...entries.values()].sort((left, right) => left.product.localeCompare(right.product));
  }, [dimensions]);

  const planningDistribution = useMemo(() => {
    type PlanningSchedule = { active: string; cycle: string; culture: string; merchandiseGroup: string; months: Record<string, number>; planned: number; product: string; subgroup: string };
    const values = new Map<string, PlanningSchedule>();
    plans.forEach((row) => {
      const product = productFor(row, "planning", dimensions);
      const cycle = cycleFor(row, dimensions);
      const culture = cultureFor(row);
      const key = `${product.canonicalKey}|${cycle}`;
      const current = values.get(key) || {
        active: product.active,
        cycle,
        culture,
        merchandiseGroup: product.merchandiseGroup || "Sem grupo",
        months: {},
        planned: 0,
        product: product.canonicalName,
        subgroup: product.subgroup || "Sem subgrupo",
      };
      const amount = standardQuantity(row, "planning", product, dimensions);
      current.planned += amount;
      const scheduledAt = dateFromPlan(readText(row, "DT_Aplicacao", "Data prevista", "Data planejada", "Data aplicação", "Data"));
      if (scheduledAt) current.months[monthKey(scheduledAt)] = (current.months[monthKey(scheduledAt)] || 0) + amount;
      values.set(key, current);
    });
    return values;
  }, [dimensions, plans]);

  const selectedClosingSchedule = useMemo(() => {
    const product = productFor({ Produto: closingDraft.product }, "planning", dimensions);
    return planningDistribution.get(`${product.canonicalKey}|${closingDraft.cycle}`);
  }, [closingDraft.cycle, closingDraft.product, dimensions, planningDistribution]);
  const registeredClosingMonths = useMemo(() => {
    const months = new Set<string>();
    for (const closing of commercialClosings.closings) {
      for (const [month, amount] of Object.entries(closing.distribution)) {
        if (amount && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) months.add(month);
      }
    }
    return [...months].sort();
  }, [commercialClosings.closings]);
  const closingMonths = useMemo(() => {
    const values = new Set<string>();
    planningDistribution.forEach((schedule) => Object.keys(schedule.months).forEach((month) => values.add(month)));
    Object.values(commercialClosings.closings).forEach((closing) => Object.keys(closing.distribution).forEach((month) => values.add(month)));
    return [...values].sort();
  }, [commercialClosings.closings, planningDistribution]);

  const resolvedCommercialClosings = useMemo(() => resolveCommercialClosings(
    commercialClosings.closings,
    planningDistribution,
    dimensions,
    new Map(commercialOrders.map((order) => [order.key, order])),
  ), [commercialClosings.closings, commercialOrders, dimensions, planningDistribution]);
  const normalizedClosingQuery = normalizeMaterial(closingQuery);
  const filteredCommercialClosings = useMemo(() => resolvedCommercialClosings.filter((entry) => (
    (closingCycleFilter === "Todos" || entry.closing.cycle === closingCycleFilter)
      && matchesCommercialClosing(entry, normalizedClosingQuery)
  )).sort((left, right) => left.physicalProduct.localeCompare(right.physicalProduct) || left.closing.supplier.localeCompare(right.closing.supplier)),
  [closingCycleFilter, normalizedClosingQuery, resolvedCommercialClosings]);
  const commercialOverview = useMemo(() => buildCommercialClosingOverview(
    planningDistribution, resolvedCommercialClosings, closingCycleFilter, normalizedClosingQuery,
  ), [closingCycleFilter, normalizedClosingQuery, planningDistribution, resolvedCommercialClosings]);

  const materialResolution = useMemo(() => {
    const input: Array<[Row[], "stock" | "transit" | "consumption"]> = [[stockRows, "stock"], [datasets.transito, "transit"], [datasets.consumo, "consumption"]];
    let described = 0;
    let resolved = 0;
    input.forEach(([rows, source]) => rows.forEach((row) => {
      const product = productFor(row, source, dimensions);
      if (product.rawName === "Sem descrição") return;
      described += 1;
      if (product.resolvedByDimension) resolved += 1;
    }));
    return { described, resolved };
  }, [stockRows, datasets.transito, datasets.consumo, dimensions]);

  const latestDataUpdate = useMemo(() => Object.values(imports)
    .map((item) => item?.importedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0], [imports]);

  const oldestSource = useMemo(() => Object.entries(imports)
    // Planejamento e Dimensões são referências de premissa. A defasagem
    // operacional passa a refletir somente fontes que mudam no dia a dia.
    .filter(([key]) => key !== "planejamento" && key !== "dimensoes")
    .filter((entry): entry is [ImportKey, ImportSummary] => Boolean(entry[1]?.fileModifiedAt))
    .sort(([, left], [, right]) => new Date(left.fileModifiedAt).getTime() - new Date(right.fileModifiedAt).getTime())[0], [imports]);
  const dataFreshness = freshnessStatus(oldestSource?.[1].fileModifiedAt, clock);

  const reconciliationIssues = useMemo<ReconciliationIssue[]>(() => {
    const issues = new Map<string, ReconciliationIssue>();
    const sources: Array<{ productSource: "planning" | "stock" | "transit" | "consumption" | "pending"; rows: Row[]; title: string }> = [
      { productSource: "planning", rows: plans, title: "Planejamento" },
      { productSource: "consumption", rows: datasets.consumo, title: "CN52" },
      { productSource: "stock", rows: datasets.estoque, title: "ZMM_BATCH" },
      { productSource: "stock", rows: datasets.estoqueMb52, title: "MB52" },
      { productSource: "transit", rows: datasets.transito, title: "MB5T" },
      { productSource: "pending", rows: pendingOrders, title: "Pedidos pendentes" },
    ];
    const add = (issue: Omit<ReconciliationIssue, "count">) => {
      const key = [issue.source, issue.detail, issue.material, issue.code].join("\u0000");
      const current = issues.get(key);
      issues.set(key, current ? { ...current, count: current.count + 1 } : { ...issue, count: 1 });
    };
    sources.forEach(({ productSource, rows, title }) => rows.forEach((row) => {
      const product = productFor(row, productSource, dimensions);
      if (product.rawName === "Sem descrição") {
        add({ source: title, material: "Sem descrição", code: product.code || "—", detail: "Descrição de material ausente", action: "Corrigir a descrição do material no arquivo de origem." });
        return;
      }
      if (!product.resolvedByDimension) {
        add({ source: title, material: product.rawName, code: product.code || "—", detail: "Sem vínculo nas dimensões", action: "Provável novo cadastro ou grafia divergente: incluir ou corrigir o material nas Dimensões." });
      }
      const nucleus = productSource === "planning" ? planningNucleusFor(row, dimensions, farmToNucleus)
        : productSource === "consumption" ? consumptionNucleusFor(row, dimensions, farmToNucleus)
          : productSource === "stock" ? stockNucleusFor(row, dimensions, farmToNucleus)
            : nucleusFor(row, dimensions, farmToNucleus);
      if (nucleus === "Sem núcleo") {
        add({ source: title, material: product.rawName, code: product.code || "—", detail: "Núcleo não conciliado", action: "Cadastrar ou corrigir o vínculo Centro/Fazenda → Núcleo nas Dimensões." });
      }
    }));
    return [...issues.values()].sort((left, right) => left.source.localeCompare(right.source) || left.material.localeCompare(right.material));
  }, [datasets.consumo, datasets.estoque, datasets.estoqueMb52, datasets.transito, dimensions, farmToNucleus, pendingOrders, plans]);

  const premiseSections = useMemo<PremiseSection[]>(() => {
    const materials = new Map<string, DimensionBundle["materials"][string]>();
    Object.values(dimensions.materials).forEach((material) => materials.set(normalizeMaterial(material.material), material));
    return [
      {
        id: "operacionais", title: "Regras operacionais", description: "Parâmetros que guiam as análises e conciliações.",
        headers: ["Premissa", "Valor"],
        rows: [["Tolerância de desvio", premises.tolerance + "%"], ["Amostra mínima", premises.sample], ["Janelas de demanda", premises.horizon], ["Status excluído", premises.excludedStatus], ["Ciclo exibido na visão DAE", dashboardSettings.daeCycle]],
      },
      {
        id: "materiais", title: "Materiais e princípios ativos", description: "Material físico, material agregado e classificação utilizada nas visões.",
        headers: ["Material físico", "Material agregado", "Princípio ativo", "Grupo", "Subgrupo", "Dose padrão"],
        rows: [...materials.values()].sort((left, right) => left.material.localeCompare(right.material)).map((material) => [material.material, material.aggregateMaterial, material.principleActive, material.merchandiseGroup, material.subgroup, material.standardDose]),
      },
      {
        id: "nucleos", title: "Centros, fazendas e núcleos", description: "Vínculos que definem onde cada saldo e demanda são consolidados.",
        headers: ["Centro ou fazenda", "Núcleo aplicado"],
        rows: Object.entries(dimensions.centerToNucleus).sort(([left], [right]) => left.localeCompare(right)).map(([center, nucleus]) => [center, nucleus]),
      },
      {
        id: "culturas", title: "Culturas e ciclos", description: "Classificação de cultura entre Safra e Safrinha.",
        headers: ["Cultura", "Ciclo aplicado"],
        rows: Object.entries(dimensions.cultureToCycle).sort(([left], [right]) => left.localeCompare(right)).map(([culture, cycle]) => [culture, cycle]),
      },
      {
        id: "conversoes", title: "Conversões de dose", description: "Fatores que convertem o saldo físico para o material agregado.",
        headers: ["Material padrão", "Apresentação física", "Fator de conversão"],
        rows: Object.entries(dimensions.conversions).sort(([left], [right]) => left.localeCompare(right)).map(([pair, factor]) => {
          const [standard, physical] = pair.split("|");
          return [standard, physical, factor];
        }),
      },
    ];
  }, [dashboardSettings.daeCycle, dimensions, premises]);
  const selectedPremiseSection = premiseSections.find((section) => section.id === premiseSection) || premiseSections[0];

  const groupedProgress = useMemo(() => {
    type ProgressRow = { group: string; subgroup: string; planned: number; applied: number };
    const values = new Map<string, ProgressRow>();
    const ensure = (cycle: string, group: string, subgroup: string) => {
      const key = [cycle, group, subgroup].join("|");
      const value = values.get(key) || { group, subgroup, planned: 0, applied: 0 };
      values.set(key, value);
      return value;
    };
    plans.forEach((row) => {
      if (isOperator && planningNucleusFor(row, dimensions, farmToNucleus) !== operatorNucleus) return;
      const product = productFor(row, "planning", dimensions);
      ensure(cycleFor(row, dimensions), product.merchandiseGroup, product.subgroup).planned += standardQuantity(row, "planning", product, dimensions);
    });
    datasets.consumo.forEach((row) => {
      if (isOperator && consumptionNucleusFor(row, dimensions, farmToNucleus) !== operatorNucleus) return;
      const product = productFor(row, "consumption", dimensions);
      ensure(cycleFor(row, dimensions), product.merchandiseGroup, product.subgroup).applied += standardQuantity(row, "consumption", product, dimensions);
    });
    return ["Safra", "Safrinha"].map((cycle) => ({
      cycle,
      rows: [...values.entries()].filter(([key]) => key.startsWith(cycle + "|")).map(([, value]) => value).sort((left, right) => right.planned - left.planned),
    }));
  }, [plans, datasets.consumo, dimensions, farmToNucleus, isOperator, operatorNucleus]);

  const macroCrop = useMemo(() => crops.map((crop) => ({
    ...crop,
    applied: datasets.execucao
      .filter((row) => headerKey(readText(row, "Cultura", "WBS element", "WBS")).includes(crop.code)
        && (!isOperator || nucleusFor(row, dimensions, farmToNucleus) === operatorNucleus))
      .reduce((sum, row) => sum + readNumber(row, "Área Executada", "Area Executada", "Qtde. executada"), 0),
  })), [datasets.execucao, dimensions, farmToNucleus, isOperator, operatorNucleus]);

  const daeByNucleus = useMemo(() => {
    type DaeGroup = { nucleus: string; culture: string; cycle: string; totalArea: number; dates: Map<string, { area: number; date: Date }> };
    const groups = new Map<string, DaeGroup>();
    plantingAreaRows.forEach((row) => {
      const cycle = cycleFor(row, dimensions);
      if (dashboardSettings.daeCycle !== "Ambos" && cycle !== dashboardSettings.daeCycle) return;
      const culture = cultureFor(row);
      const nucleus = planningNucleusFor(row, dimensions, farmToNucleus);
      const area = planningArea(row);
      const key = [nucleus, culture, cycle].join("|");
      const group = groups.get(key) || { nucleus, culture, cycle, totalArea: 0, dates: new Map() };
      group.totalArea += area;
      const plantingDate = dateFromPlan(readText(row, "Data de plantio", "Data Plantio", "Dt. Plantio", "Dt Plantio", "DT_Plantio", "DATA_PLANTIO", "Plantio"));
      if (plantingDate) {
        const dateKeyValue = dateKey(plantingDate);
        const dateGroup = group.dates.get(dateKeyValue) || { area: 0, date: plantingDate };
        dateGroup.area += area;
        group.dates.set(dateKeyValue, dateGroup);
      }
      groups.set(key, group);
    });
    const nucleusGroups = new Map<string, Array<{ area: number; culture: string; cycle: string; days: number; plantedAt: Date; share: number }>>();
    groups.forEach((group) => group.dates.forEach((dateGroup) => {
      const entries = nucleusGroups.get(group.nucleus) || [];
      entries.push({
        area: dateGroup.area,
        culture: group.culture,
        cycle: group.cycle,
        days: Math.max(0, -daysFromToday(dateGroup.date, new Date(clock))),
        plantedAt: dateGroup.date,
        share: group.totalArea ? dateGroup.area * 100 / group.totalArea : 0,
      });
      nucleusGroups.set(group.nucleus, entries);
    }));
    const result = [...nucleusGroups.entries()].map(([nucleus, entries]) => ({
      nucleus,
      entries: entries.sort((left, right) => right.days - left.days || right.area - left.area),
    })).sort((left, right) => left.nucleus.localeCompare(right.nucleus));
    return isOperator ? result.filter((group) => group.nucleus === operatorNucleus) : result;
  }, [clock, dashboardSettings.daeCycle, dimensions, farmToNucleus, isOperator, operatorNucleus, plantingAreaRows]);

  const filters = useMemo(() => ({
    cycles: ["Todos", ...new Set(ledger.flatMap((row) => row.cycles))],
    groups: ["Todos", ...new Set(ledger.map((row) => row.merchandiseGroup))],
    subgroups: ["Todos", ...new Set(ledger.map((row) => row.subgroup))],
    cultures: ["Todos", ...new Set(ledger.flatMap((row) => row.cultures))],
  }), [ledger]);
  const monitoringLedger = useMemo(() => {
    const matchesScope = (row: Row, source: "planning" | "consumption") => {
      const product = productFor(row, source, dimensions);
      return (cycleFilter === "Todos" || cycleFor(row, dimensions) === cycleFilter)
        && (groupFilter === "Todos" || product.merchandiseGroup === groupFilter)
        && (subgroupFilter === "Todos" || product.subgroup === subgroupFilter)
        && (cultureFilter === "Todos" || cultureFor(row) === cultureFilter);
    };
    return buildReconciliation({
      bundle: dimensions,
      planningRows: plans.filter((row) => matchesScope(row, "planning")),
      stockRows,
      transitRows: datasets.transito,
      consumptionRows: datasets.consumo.filter((row) => matchesScope(row, "consumption")),
      pendingRows: pendingOrders,
      farmToNucleus,
    });
  }, [cycleFilter, cultureFilter, datasets.consumo, stockRows, datasets.transito, dimensions, farmToNucleus, groupFilter, pendingOrders, plans, subgroupFilter]);

  const warehouseMonitoringRows = useMemo(() => {
    const context = new Map<string, { cultures: Set<string>; cycles: Set<string> }>();
    monitoringLedger.forEach((row) => {
      const current = context.get(row.canonicalKey) || { cultures: new Set<string>(), cycles: new Set<string>() };
      row.cultures.forEach((culture) => current.cultures.add(culture));
      row.cycles.forEach((cycle) => current.cycles.add(cycle));
      context.set(row.canonicalKey, current);
    });
    const values = new Map<string, MonitoringRow>();
    monitoringLedger.forEach((row) => row.locations.filter((location) => location.type === "Armazém" && location.amount !== 0).forEach((location) => {
      const id = row.canonicalKey + "|ARMAZEM";
      const sourceContext = context.get(row.canonicalKey);
      const current = values.get(id) || {
        active: row.active,
        applied: 0,
        available: 0,
        canonicalKey: row.canonicalKey,
        codes: [],
        cultures: [...(sourceContext?.cultures || [])].sort(),
        cycles: [...(sourceContext?.cycles || [])].sort(),
        farmBalance: 0,
        id,
        isWarehouseView: true,
        locations: [],
        merchandiseGroup: row.merchandiseGroup,
        nucleus: "ARMAZÉM",
        pendingOrder: 0,
        planned: 0,
        plannedMaterials: [],
        shortage: 0,
        standardMaterial: row.standardMaterial,
        stockMaterials: [],
        subgroup: row.subgroup,
        transit: 0,
        warehouseBalance: 0,
      };
      current.warehouseBalance += location.amount;
      current.locations.push({ ...location });
      if (!current.stockMaterials.includes(location.material)) current.stockMaterials.push(location.material);
      values.set(id, current);
    }));
    return [...values.values()].map((row) => ({ ...row, available: row.warehouseBalance, stockMaterials: row.stockMaterials.sort() }));
  }, [monitoringLedger]);

  const monitoringNuclei = useMemo(() => ["Todos", ...[...new Set([
    ...monitoringLedger.map((row) => row.nucleus),
    ...warehouseMonitoringRows.map((row) => row.nucleus),
  ])].sort()], [monitoringLedger, warehouseMonitoringRows]);

  const executionRows = useMemo(() => {
    const search = normalizeMaterial(query);
    const farmRows: MonitoringRow[] = monitoringLedger.map((row) => {
      const locations = row.locations.filter((location) => location.type !== "Armazém");
      const stockMaterials = [...new Set(locations.map((location) => location.material))].sort();
      return {
        ...row,
        available: row.farmBalance + row.transit,
        locations,
        shortage: Math.max(0, row.planned - row.applied - row.farmBalance - row.transit),
        stockMaterials,
        warehouseBalance: 0,
      };
    }).filter((row) => row.planned || row.applied || row.pendingOrder || row.transit || row.farmBalance);
    return [...farmRows, ...warehouseMonitoringRows].filter((row) => {
      const line = normalizeMaterial([row.active, row.standardMaterial, row.stockMaterials.join(" "), row.plannedMaterials.join(" "), row.nucleus, ...row.locations.map((location) => location.location)].join(" "));
      return (cycleFilter === "Todos" || row.cycles.includes(cycleFilter))
        && (groupFilter === "Todos" || row.merchandiseGroup === groupFilter)
        && (subgroupFilter === "Todos" || row.subgroup === subgroupFilter)
        && (cultureFilter === "Todos" || row.cultures.includes(cultureFilter))
        && (nucleusFilter === "Todos" || row.nucleus === nucleusFilter)
        && (!search || line.includes(search));
    }).sort((left, right) => left.active.localeCompare(right.active)
      || left.standardMaterial.localeCompare(right.standardMaterial)
      || left.nucleus.localeCompare(right.nucleus));
  }, [cycleFilter, cultureFilter, groupFilter, monitoringLedger, nucleusFilter, query, subgroupFilter, warehouseMonitoringRows]);

  const monitoringGroups = useMemo<MonitoringGroup[]>(() => {
    const groups = new Map<string, MonitoringRow[]>();
    executionRows.forEach((row) => {
      const active = row.active || "Princípio ativo não informado";
      const rows = groups.get(active) || [];
      rows.push(row);
      groups.set(active, rows);
    });
    return [...groups.entries()].map(([active, rows]) => ({
      active,
      rows,
      totals: rows.reduce((totals, row) => ({
        applied: totals.applied + row.applied,
        balance: totals.balance + row.farmBalance + row.warehouseBalance,
        pendingOrder: totals.pendingOrder + row.pendingOrder,
        planned: totals.planned + row.planned,
        toDeliver: totals.toDeliver + amountToDeliver(row),
        transit: totals.transit + row.transit,
      }), { applied: 0, balance: 0, pendingOrder: 0, planned: 0, toDeliver: 0, transit: 0 }),
    }));
  }, [executionRows]);

  const executedAreaByTask = useMemo(() => {
    const values = new Map<string, number>();
    datasets.execucao.forEach((row) => {
      if (statusExcluded(row, premises.excludedStatus)) return;
      const key = taskKey(row);
      const area = readNumber(row, "Área Executada", "Area Executada");
      if (!key || area <= 0) return;
      values.set(key, (values.get(key) || 0) + area);
    });
    return values;
  }, [datasets.execucao, premises.excludedStatus]);

  const executionPerformance = useMemo(() => {
    const values = new Map<string, PerformanceAccumulator>();
    const ensure = (product: ReturnType<typeof productFor>, nucleus: string, cycle: string, culture: string) => {
      const id = product.canonicalKey + "|" + normalizeMaterial(nucleus);
      const current = values.get(id) || {
        active: product.active,
        appliedArea: 0,
        appliedVolume: 0,
        canonicalKey: product.canonicalKey,
        cultures: new Set<string>(),
        cycles: new Set<string>(),
        merchandiseGroup: product.merchandiseGroup,
        neededVolume: 0,
        nucleus,
        plannedArea: 0,
        plannedVolume: 0,
        standardMaterial: product.canonicalName,
        subgroup: product.subgroup,
      };
      if (product.active !== "Não conciliado") current.active = product.active;
      if (product.merchandiseGroup !== "Sem grupo") current.merchandiseGroup = product.merchandiseGroup;
      if (product.subgroup !== "Sem subgrupo") current.subgroup = product.subgroup;
      if (cycle !== "Sem ciclo") current.cycles.add(cycle);
      if (culture !== "Sem cultura") current.cultures.add(culture);
      values.set(id, current);
      return { current, id };
    };

    plans.forEach((row) => {
      const product = productFor(row, "planning", dimensions);
      if (product.rawName === "Sem descrição") return;
      const nucleus = planningNucleusFor(row, dimensions, farmToNucleus);
      const item = ensure(product, nucleus, cycleFor(row, dimensions), cultureFor(row));
      item.current.plannedVolume += standardQuantity(row, "planning", product, dimensions);
      item.current.plannedArea += planningArea(row);
    });

    const seenArea = new Set<string>();
    datasets.consumo.forEach((row) => {
      const product = productFor(row, "consumption", dimensions);
      if (product.rawName === "Sem descrição") return;
      const nucleus = consumptionNucleusFor(row, dimensions, farmToNucleus);
      const item = ensure(product, nucleus, cycleFor(row, dimensions), cultureFor(row));
      item.current.appliedVolume += standardQuantity(row, "consumption", product, dimensions);
      item.current.neededVolume += standardAmount(readNumber(row, "Qtd.necess.", "Qtd necess.", "Quantidade necessária", "Quantidade necessaria"), product, dimensions);
      const areaKey = item.id + "|" + taskKey(row);
      const area = executedAreaByTask.get(taskKey(row)) || 0;
      if (taskKey(row) && area > 0 && !seenArea.has(areaKey)) {
        item.current.appliedArea += area;
        seenArea.add(areaKey);
      }
    });

    return [...values.entries()].map(([id, value]) => {
      const plannedVolume = value.plannedVolume || value.neededVolume;
      const plannedDose = value.plannedArea > 0 ? plannedVolume / value.plannedArea : null;
      const appliedDose = value.appliedArea > 0 ? value.appliedVolume / value.appliedArea : null;
      const volumeImpact = plannedDose !== null && value.appliedArea > 0
        ? value.appliedVolume - plannedDose * value.appliedArea
        : null;
      return {
        ...value,
        id,
        cultures: [...value.cultures].sort(),
        cycles: [...value.cycles].sort(),
        plannedDose,
        plannedVolume,
        appliedDose,
        volumeImpact,
      };
    }).filter((row) => row.plannedVolume || row.appliedVolume).sort((left, right) => right.plannedVolume - left.plannedVolume);
  }, [plans, datasets.consumo, dimensions, farmToNucleus, executedAreaByTask]);

  const performanceRows = useMemo(() => {
    const search = normalizeMaterial(query);
    return executionPerformance.filter((row) => {
      const line = normalizeMaterial([row.active, row.standardMaterial, row.nucleus, row.subgroup, row.merchandiseGroup].join(" "));
      return (cycleFilter === "Todos" || row.cycles.includes(cycleFilter))
        && (groupFilter === "Todos" || row.merchandiseGroup === groupFilter)
        && (subgroupFilter === "Todos" || row.subgroup === subgroupFilter)
        && (cultureFilter === "Todos" || row.cultures.includes(cultureFilter))
        && (!isOperator || row.nucleus === operatorNucleus)
        && (!search || line.includes(search));
    });
  }, [executionPerformance, cycleFilter, groupFilter, subgroupFilter, cultureFilter, isOperator, operatorNucleus, query]);

  const performanceSummary = useMemo(() => {
    const planned = performanceRows.reduce((sum, row) => sum + row.plannedVolume, 0);
    const applied = performanceRows.reduce((sum, row) => sum + row.appliedVolume, 0);
    const doseRows = performanceRows.filter((row) => row.plannedDose !== null && row.appliedArea > 0);
    const executedArea = doseRows.reduce((sum, row) => sum + row.appliedArea, 0);
    const plannedDose = executedArea > 0
      ? doseRows.reduce((sum, row) => sum + (row.plannedDose || 0) * row.appliedArea, 0) / executedArea
      : null;
    const appliedDose = executedArea > 0
      ? doseRows.reduce((sum, row) => sum + row.appliedVolume, 0) / executedArea
      : null;
    const impact = doseRows.reduce((sum, row) => sum + (row.volumeImpact || 0), 0);
    return { applied, appliedDose, executedArea, impact, planned, plannedDose };
  }, [performanceRows]);

  const provision = useMemo(() => {
    const start = new Date(evaluationDate + "T00:00:00");
    const finish = new Date(provisionUntil + "T23:59:59");
    const dated = plans.map((row) => ({ row, date: dateFromPlan(readText(row, "DT_Aplicacao", "Data prevista", "Data planejada", "Data aplicação", "Data")) }));
    const scheduled = dated.filter((item) => item.date);
    const windowPlans = scheduled.length ? scheduled.filter((item) => item.date! >= start && item.date! <= finish).map((item) => item.row) : plans;
    const windowLedger = buildReconciliation({
      bundle: dimensions, planningRows: windowPlans, stockRows, transitRows: datasets.transito,
      consumptionRows: datasets.consumo, pendingRows: pendingOrders, farmToNucleus,
    });
    const demands: DemandRow[] = windowLedger.filter((row) => row.planned > 0).map((row) => ({
      ...row,
      demand: Math.max(0, row.planned - row.applied),
      local: row.farmBalance + row.transit,
    }));
    const allocation = allocateCentralWarehouse(demands, windowLedger);
    const rows = demands.map((row) => {
      const warehouse = allocation.allocations.get(row.id) || { allocated: 0, locations: [] };
      const nucleusSupportLocations = supportFromOtherNuclei(row, demands);
      const nucleusSupport = nucleusSupportLocations.reduce((sum, location) => sum + location.amount, 0);
      const balance = row.local + warehouse.allocated - row.demand;
      const status = row.demand <= row.local ? "Atende no núcleo" : balance >= 0 ? "Atende com armazém" : "Falta";
      // A BATCH possui uma linha por lote. A calendarização é operacional,
      // então exibe uma única linha por material, tipo de saldo e localização.
      return {
        ...row,
        balance,
        locations: consolidateLocations([...row.locations, ...nucleusSupportLocations]),
        status,
        warehouseLocations: consolidateLocations(warehouse.locations),
        warehouseSupport: warehouse.allocated,
        nucleusSupport,
        nucleusSupportLocations,
      };
    }).sort((left, right) => left.balance - right.balance || right.demand - left.demand);
    const scopedRows = isOperator ? rows.filter((row) => row.nucleus === operatorNucleus) : rows;
    return {
      dated: scheduled.length > 0, rows: scopedRows,
      demand: scopedRows.reduce((sum, row) => sum + row.demand, 0),
      farm: scopedRows.reduce((sum, row) => sum + row.farmBalance, 0),
      pendingOrder: scopedRows.reduce((sum, row) => sum + row.pendingOrder, 0),
      transit: scopedRows.reduce((sum, row) => sum + row.transit, 0),
      warehouse: allocation.totalAvailable,
      nucleusSupport: scopedRows.reduce((sum, row) => sum + row.nucleusSupport, 0),
    };
  }, [evaluationDate, provisionUntil, plans, dimensions, stockRows, datasets.transito, datasets.consumo, pendingOrders, farmToNucleus, isOperator, operatorNucleus]);

  const consolidatedSupply = useMemo(() => {
    const demands: DemandRow[] = ledger.filter((row) => row.planned > 0).map((row) => ({
      ...row,
      demand: Math.max(0, row.planned - row.applied),
      local: row.farmBalance + row.transit,
    }));
    const allocation = allocateCentralWarehouse(demands, ledger);
    const failures = demands.filter((row) => {
      const assigned = allocation.allocations.get(row.id)?.allocated || 0;
      return row.local + assigned < row.demand;
    });
    return {
      failures,
      shortage: failures.reduce((sum, row) => sum + Math.max(0, row.demand - row.local - (allocation.allocations.get(row.id)?.allocated || 0)), 0),
    };
  }, [ledger]);

  const pendingSignals = useMemo<PendingSignal[]>(() => pendingOrders.map((row, index) => {
    const product = productFor(row, "pending", dimensions);
    const nucleus = nucleusFor(row, dimensions, farmToNucleus);
    const dueDateValue = readText(row, "DtRemPed", "Dt. Rem. Ped", "Data remessa", "Data prevista", "Previsão de utilização", "Previsao de utilizacao");
    const previousDueDate = dateFromPlan(dueDateValue);
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDateValue) ? dateFromPlan(`${dueDateValue}T00:00:00`) : previousDueDate;
    const daysUntil = dueDate ? daysFromToday(dueDate, new Date(clock)) : null;
    const reference = readText(row, "Pedido", "Nº pedido", "No pedido", "Documento", "Doc. compra", "Solicitação", "Solicitacao") || "Pedido pendente";
    const signal = pendingSignalStatus(daysUntil);
    return {
      // Mantém o vínculo das tarefas já registradas para datas ISO antes interpretadas em UTC.
      id: normalizeMaterial([reference, product.rawName, nucleus, previousDueDate ? dateKey(previousDueDate) : String(index)].join("|")) || `pedido-${index}`,
      dueDate,
      daysUntil,
      material: product.canonicalName,
      physicalMaterial: product.rawName,
      nucleus,
      quantity: standardQuantity(row, "pending", product, dimensions),
      reference,
      row,
      ...signal,
    };
  }).sort((left, right) => (left.daysUntil ?? Number.MAX_SAFE_INTEGER) - (right.daysUntil ?? Number.MAX_SAFE_INTEGER)), [clock, dimensions, farmToNucleus, pendingOrders]);

  const logisticsRequests = useMemo(() => {
    type LogisticsRequestLine = { id: string; lot: string; product: string; productCode: string; quantity: number; unit: string };
    type LogisticsRequest = { date: string; destination: string; destinationCode: string; id: string; sourceWarehouse: string; status: string; lines: LogisticsRequestLine[] };
    const values = new Map<string, LogisticsRequest>();
    datasets.solicitacoesWeb.forEach((row, index) => {
      const id = readText(row, "Nº Solicitação", "N° Solicitação", "Numero Solicitação", "Numero Solicitacao", "Solicitação", "Solicitacao");
      const product = readText(row, "Descrição Produto", "Descricao Produto", "Produto");
      const status = readText(row, "St. do Atendimento");
      const shippingStatus = readText(row, "Situação de Envio ao Rodopar", "Situacao de Envio ao Rodopar");
      if (!id || !product || headerKey(status).includes("CANCEL") || headerKey(shippingStatus).includes("CANCEL")) return;
      const current = values.get(id) || {
        date: readText(row, "Data Atendimento", "Data"),
        destination: readText(row, "Nome do Tomador", "Nome do Responsável", "Nome do Responsavel"),
        destinationCode: readText(row, "Cód. Cliente Ind.", "Cod. Cliente Ind.", "Cód. Cliente Destino", "Cod. Cliente Destino"),
        id,
        sourceWarehouse: readText(row, "Apelido Op. Logístico", "Apelido Op. Logistico", "Nome Op. Logístico", "Nome Op. Logistico"),
        status: status || "Sem status",
        lines: [],
      };
      current.lines.push({
        id: `${id}|${index}|${normalizeMaterial(product)}|${normalizeMaterial(readText(row, "Lote"))}`,
        lot: readText(row, "Lote"),
        product,
        productCode: readText(row, "Cód. Prod. Indústria", "Cod. Prod. Industria", "Cód. Prod. Operador", "Cod. Prod. Operador"),
        quantity: readNumber(row, "Qt. Solicitada", "Qt Solicitada", "Quantidade solicitada", "Quantidade"),
        unit: readText(row, "UMB", "Und", "Unidade") || "UN",
      });
      values.set(id, current);
    });
    return [...values.values()].sort((left, right) => right.id.localeCompare(left.id, "pt-BR", { numeric: true }));
  }, [datasets.solicitacoesWeb]);
  const selectedLogisticsRequest = logisticsRequests.find((request) => request.id === tripRequestId) || null;
  const selectedLogisticsLine = selectedLogisticsRequest?.lines.find((line) => line.id === tripMaterialKey) || null;
  const selectedLogisticsStock = useMemo(() => {
    if (!selectedLogisticsLine) return { balance: 0, pallets: 0, warehouses: [] as string[] };
    const productKey = normalizeMaterial(selectedLogisticsLine.product);
    const lotKey = normalizeMaterial(selectedLogisticsLine.lot);
    const matches = datasets.estoqueWeb.filter((row) => {
      const product = normalizeMaterial(readText(row, "Descrição Produto", "Descricao Produto", "Produto"));
      const lot = normalizeMaterial(readText(row, "Lote"));
      return product === productKey && (!lotKey || lot === lotKey);
    });
    return {
      balance: matches.reduce((sum, row) => sum + readNumber(row, "Saldo"), 0),
      pallets: matches.reduce((sum, row) => sum + readNumber(row, "Qt Paletes", "Qtd Paletes"), 0),
      warehouses: [...new Set(matches.map((row) => readText(row, "Nome Op. Logístico", "Nome Op. Logistico", "Armazém", "Armazem")).filter(Boolean))],
    };
  }, [datasets.estoqueWeb, selectedLogisticsLine]);
  const selectedRouteItem = useMemo<LogisticsTripItem | null>(() => {
    if (!selectedLogisticsRequest || !selectedLogisticsLine) return null;
    return {
      id: selectedLogisticsLine.id,
      requestId: selectedLogisticsRequest.id,
      requestDate: selectedLogisticsRequest.date,
      product: selectedLogisticsLine.product,
      productCode: selectedLogisticsLine.productCode,
      lot: selectedLogisticsLine.lot,
      quantity: selectedLogisticsLine.quantity,
      unit: selectedLogisticsLine.unit,
      sourceWarehouse: selectedLogisticsStock.warehouses.join(", ") || selectedLogisticsRequest.sourceWarehouse || "Armazém não identificado",
      destination: selectedLogisticsRequest.destination || "Destino não identificado",
      destinationCode: selectedLogisticsRequest.destinationCode,
    };
  }, [selectedLogisticsLine, selectedLogisticsRequest, selectedLogisticsStock]);

  const scopedPendingSignals = useMemo(() => isOperator
    ? pendingSignals.filter((signal) => signal.nucleus === operatorNucleus)
    : pendingSignals, [isOperator, operatorNucleus, pendingSignals]);
  const farol = useMemo(() => ({
    demand: scopedPendingSignals.filter((signal) => signal.status === "Demanda próxima").length,
    delay: scopedPendingSignals.filter((signal) => signal.status === "Possível atraso").length,
    attention: scopedPendingSignals.filter((signal) => signal.status === "Ponto de atenção").length,
    alert: scopedPendingSignals.filter((signal) => signal.status === "Alerta").length,
  }), [scopedPendingSignals]);

  const taskNuclei = useMemo(() => ["Todos", ...[...new Set(scopedPendingSignals.map((signal) => signal.nucleus).filter(Boolean))].sort()], [scopedPendingSignals]);
  const taskOrders = useMemo(() => ["Todos", ...[...new Set(scopedPendingSignals.map((signal) => signal.reference).filter(Boolean))].sort()], [scopedPendingSignals]);
  const taskMaterialOptions = useMemo(() => [...new Set([
    ...ledger.map((row) => row.standardMaterial),
    ...ledger.flatMap((row) => row.stockMaterials),
    ...scopedPendingSignals.map((signal) => signal.material),
  ].filter(Boolean))].sort(), [ledger, scopedPendingSignals]);
  const filteredPendingSignals = useMemo(() => {
    const materialSearch = normalizeMaterial(taskMaterialFilter);
    return scopedPendingSignals.filter((signal) => (taskSignalFilter === "Todos" || signal.status === taskSignalFilter)
      && (taskOrderFilter === "Todos" || signal.reference === taskOrderFilter)
      && (taskNucleusFilter === "Todos" || signal.nucleus === taskNucleusFilter)
      && (!materialSearch || normalizeMaterial(signal.material).includes(materialSearch)));
  }, [scopedPendingSignals, taskMaterialFilter, taskNucleusFilter, taskOrderFilter, taskSignalFilter]);
  const notificationDraft = useMemo(() => {
    if (!showNotification) return null;
    const minimumDays = Number(notificationDays);
    const candidates = scopedPendingSignals.filter((signal) => signal.daysUntil !== null
      && signal.daysUntil <= -minimumDays
      && (notificationNucleus === "Todos" || signal.nucleus === notificationNucleus));
    if (!candidates.length) return null;

    const rows = resolveTaskNotificationOrders(candidates, pendingSignals, datasets.pedidosCompra, notificationSource?.rows);
    return rows.length ? { ...buildTaskNotification(notificationNucleus, minimumDays, rows), count: rows.length } : null;
  }, [datasets.pedidosCompra, notificationDays, notificationNucleus, notificationSource, pendingSignals, scopedPendingSignals, showNotification]);
  const notificationRecipients = parseNotificationRecipients(notificationTo);
  const notificationCopy = parseNotificationRecipients(notificationCc);
  const outlookDraftUrl = !notificationSourceLoading && notificationDraft && notificationRecipients?.length && notificationCopy
    ? buildNotificationMailto(notificationDraft.subject, notificationRecipients, notificationCopy)
    : null;

  const supplyAlerts = useMemo<OperationalAlert[]>(() => {
    const start = startOfDay(new Date(clock));
    const finish = new Date(start);
    finish.setDate(finish.getDate() + 30);
    const datedPlans = plans.map((row) => ({ row, dueDate: dateFromPlan(readText(row, "DT_Aplicacao", "Data prevista", "Data planejada", "Data aplicação", "Data")) }));
    const plannedSoon = datedPlans.filter((item) => item.dueDate && item.dueDate >= start && item.dueDate <= finish);
    if (!plannedSoon.length) return [];
    const dueDates = new Map<string, Date>();
    plannedSoon.forEach(({ row, dueDate }) => {
      const product = productFor(row, "planning", dimensions);
      const nucleus = planningNucleusFor(row, dimensions, farmToNucleus);
      const id = `${product.canonicalKey}|${normalizeMaterial(nucleus)}`;
      const current = dueDates.get(id);
      if (!current || dueDate! < current) dueDates.set(id, dueDate!);
    });
    const windowLedger = buildReconciliation({
      bundle: dimensions, planningRows: plannedSoon.map((item) => item.row), stockRows,
      transitRows: datasets.transito, consumptionRows: datasets.consumo, pendingRows: pendingOrders, farmToNucleus,
    });
    const demands: DemandRow[] = windowLedger.filter((row) => row.planned > row.applied).map((row) => ({
      ...row, demand: Math.max(0, row.planned - row.applied), local: row.farmBalance + row.transit,
    }));
    const allocation = allocateCentralWarehouse(demands, windowLedger);
    return demands.filter((row) => row.demand > 0 && row.farmBalance <= 0).map((row) => {
      const support = allocation.allocations.get(row.id) || { allocated: 0, locations: [] };
      const locations = consolidateLocations(support.locations);
      // O rateio indica o apoio possível; o aviso também expõe o saldo físico
      // completo por armazém para o gestor avaliar a origem do repasse.
      const warehouseBalances = consolidateWarehouseBalances(windowLedger
        .filter((candidate) => candidate.canonicalKey === row.canonicalKey)
        .flatMap((candidate) => candidate.locations));
      const place = locations.map((location) => location.location).join(", ");
      const fromCuiaba = locations.some((location) => normalizeMaterial(location.location).includes("CUIABA"));
      const dueDate = dueDates.get(row.id);
      const warehouseDetail = support.allocated > 0
        ? ` Há ${formatNumber(support.allocated)} no armazém${place ? `: ${place}` : ""}.${fromCuiaba ? " Origem Cuiabá: priorize o envio pelo maior tempo logístico." : " Priorize o repasse ao núcleo."}`
        : " Não há apoio disponível no armazém para esta demanda.";
      return {
        id: `repasse-${row.id}`,
        category: "Repasse em até 30 dias",
        severity: support.allocated > 0 ? "attention" : "critical",
        title: `${row.standardMaterial} — ${row.nucleus}`,
        detail: `Uso previsto ${dueDate ? new Intl.DateTimeFormat("pt-BR").format(dueDate) : "nos próximos 30 dias"}; a fazenda não possui saldo. Demanda restante: ${formatNumber(row.demand)}.${warehouseDetail}`,
        metric: `${formatNumber(row.demand)} necessários`,
        warehouseBalances,
      };
    });
  }, [clock, datasets.consumo, datasets.transito, dimensions, farmToNucleus, pendingOrders, plans, stockRows]);

  const doseIncreaseAlerts = useMemo<OperationalAlert[]>(() => executionPerformance
    .filter((row) => row.plannedDose !== null && row.plannedDose > 0 && row.appliedDose !== null && row.appliedDose > row.plannedDose * 1.05)
    .map((row) => {
      const increase = ((row.appliedDose! / row.plannedDose!) - 1) * 100;
      return {
        id: `dose-${row.id}`,
        category: "Aumento de dose na execução",
        severity: increase >= 15 ? "critical" : "attention",
        title: `${row.standardMaterial} — ${row.nucleus}`,
        detail: `Dose executada ${formatDose(row.appliedDose)} frente a ${formatDose(row.plannedDose)} planejada. O acréscimo gera ${signedNumber(row.volumeImpact)} de impacto na área já executada.`,
        metric: `+${increase.toFixed(1)}%`,
      };
    }).sort((left, right) => Number(right.metric.replace(/[^0-9,.]/g, "").replace(",", ".")) - Number(left.metric.replace(/[^0-9,.]/g, "").replace(",", "."))), [executionPerformance]);

  const expiredStockAlerts = useMemo<OperationalAlert[]>(() => {
    const values = new Map<string, { amount: number; days: number; location: string; material: string; type: string; value: number }>();
    stockRows.forEach((row) => {
      const expiry = dateFromPlan(readText(row, "Dt. Validade", "Dt Validade", "Data de validade", "Data Validade", "Validade"));
      if (!expiry || expiry >= startOfDay(new Date(clock))) return;
      const product = productFor(row, "stock", dimensions);
      if (product.rawName === "Sem descrição") return;
      const nucleus = stockNucleusFor(row, dimensions, farmToNucleus);
      const location = stockLocationFor(row, nucleus);
      const key = [product.canonicalKey, location.type, location.place].join("|");
      const current = values.get(key) || { amount: 0, days: 0, location: location.place, material: product.canonicalName, type: location.type, value: 0 };
      current.amount += standardQuantity(row, "stock", product, dimensions);
      current.days = Math.max(current.days, Math.max(1, -daysFromToday(expiry, new Date(clock))));
      current.value += readNumber(row, "Valor total", "Valor Total", "Valor", "Val. total", "Valor estoque");
      values.set(key, current);
    });
    return [...values.entries()].map(([id, item]) => ({
      id: `vencido-${id}`,
      category: "Estoque vencido",
      severity: "critical" as const,
      title: `${item.material} — ${item.type}`,
      detail: `${item.location}. Produto vencido há ${item.days} dia${item.days === 1 ? "" : "s"}; saldo convertido de ${formatNumber(item.amount)} e valor agregado de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.value)}.`,
      metric: `${item.days} dia${item.days === 1 ? "" : "s"}`,
    })).sort((left, right) => Number(right.metric.split(" ")[0]) - Number(left.metric.split(" ")[0]));
  }, [clock, dimensions, farmToNucleus, stockRows]);

  const operationalAlerts = useMemo(() => [...supplyAlerts, ...doseIncreaseAlerts, ...expiredStockAlerts], [doseIncreaseAlerts, expiredStockAlerts, supplyAlerts]);
  const scopedOperationalAlerts = useMemo(() => {
    if (!isOperator) return operationalAlerts;
    const normalizedNucleus = normalizeMaterial(operatorNucleus);
    return operationalAlerts.filter((alert) => normalizeMaterial(`${alert.title} ${alert.detail}`).includes(normalizedNucleus));
  }, [isOperator, operationalAlerts, operatorNucleus]);
  const scopedAlertCounts = useMemo(() => ({
    dose: scopedOperationalAlerts.filter((alert) => alert.category === "Aumento de dose na execução").length,
    expired: scopedOperationalAlerts.filter((alert) => alert.category === "Estoque vencido").length,
    supply: scopedOperationalAlerts.filter((alert) => alert.category === "Repasse em até 30 dias").length,
  }), [scopedOperationalAlerts]);
  const alertNuclei = useMemo(() => {
    if (isOperator) return operatorHasNucleus ? [operatorNucleus] : [];
    return ["Todos", ...[...new Set(ledger.map((row) => row.nucleus).filter(Boolean))].sort()];
  }, [isOperator, ledger, operatorHasNucleus, operatorNucleus]);
  const alertGroups = useMemo(() => ["Todos", ...[...new Set(ledger.map((row) => row.merchandiseGroup).filter(Boolean))].sort()], [ledger]);
  const alertSubgroups = useMemo(() => ["Todos", ...[...new Set(ledger.map((row) => row.subgroup).filter(Boolean))].sort()], [ledger]);
  const filteredOperationalAlerts = useMemo(() => {
    const material = normalizeMaterial(alertMaterialFilter);
    const enforcedNucleus = isOperator ? operatorNucleus : alertNucleusFilter;
    const baseAlerts = isOperator ? scopedOperationalAlerts : operationalAlerts;
    const hasFilter = enforcedNucleus !== "Todos" || Boolean(material) || alertGroupFilter !== "Todos" || alertSubgroupFilter !== "Todos";
    if (!hasFilter) return baseAlerts;
    const rowsInScope = ledger.filter((row) => (enforcedNucleus === "Todos" || row.nucleus === enforcedNucleus)
      && (alertGroupFilter === "Todos" || row.merchandiseGroup === alertGroupFilter)
      && (alertSubgroupFilter === "Todos" || row.subgroup === alertSubgroupFilter)
      && (!material || normalizeMaterial([row.standardMaterial, ...row.stockMaterials].join(" ")).includes(material)));
    return baseAlerts.filter((alert) => {
      const searchable = normalizeMaterial(`${alert.title} ${alert.detail}`);
      return rowsInScope.some((row) => [row.nucleus, row.active, row.standardMaterial, ...row.stockMaterials]
        .filter(Boolean)
        .some((value) => searchable.includes(normalizeMaterial(value))));
    });
  }, [alertGroupFilter, alertMaterialFilter, alertNucleusFilter, alertSubgroupFilter, isOperator, ledger, operatorNucleus, operationalAlerts, scopedOperationalAlerts]);
  const warehouseStockRelations = useMemo(() => {
    const values = new Map<string, { active: string; group: string; subgroup: string; material: string; standardMaterial: string; warehouse: string; balance: number }>();
    ledger.forEach((row) => row.locations.filter((location) => location.type === "Armazém" && location.amount > 0).forEach((location) => {
      const key = [row.canonicalKey, location.material, location.location].join("\u0000");
      const current = values.get(key);
      values.set(key, current ? { ...current, balance: current.balance + location.amount } : {
        active: row.active,
        group: row.merchandiseGroup,
        subgroup: row.subgroup,
        material: location.material,
        standardMaterial: row.standardMaterial,
        warehouse: location.location,
        balance: location.amount,
      });
    }));
    const material = normalizeMaterial(alertMaterialFilter);
    return [...values.values()].filter((row) => (alertGroupFilter === "Todos" || row.group === alertGroupFilter)
      && (alertSubgroupFilter === "Todos" || row.subgroup === alertSubgroupFilter)
      && (!material || normalizeMaterial([row.active, row.standardMaterial, row.material].join(" ")).includes(material)))
      .sort((left, right) => left.warehouse.localeCompare(right.warehouse) || left.material.localeCompare(right.material));
  }, [alertGroupFilter, alertMaterialFilter, alertSubgroupFilter, ledger]);

  async function importFiles() {
    if (currentUser?.role !== "admin") { setMessage("Somente administradores podem importar ou substituir arquivos operacionais."); return; }
    const selected = sourceConfig.filter((source) => uploads[source.key]);
    if (!selected.length) { setMessage("Selecione ao menos uma fonte antes de importar."); return; }
    setImporting(true);
    setMessage("");
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const loaded: Array<{ key: SourceKey; rows: Row[]; summary: ImportSummary; warnings: number }> = [];
      for (const source of selected) {
        const file = uploads[source.key]!;
        setImportProgress(`Lendo ${source.title} em segundo plano (${loaded.length + 1} de ${selected.length})...`);
        const parsed = await parseImportFile(file, source);
        loaded.push({
          key: source.key,
          rows: parsed.rows,
          summary: {
            fileName: file.name,
            fileModifiedAt: new Date(file.lastModified || Date.now()).toISOString(),
            importedAt: new Date().toISOString(),
            rows: parsed.rowCount,
            sheets: parsed.sheets,
          },
          warnings: importWarnings(parsed.rows, source.key).total,
        });
      }
      setImportProgress("Aplicando a carga conciliada aos visuais...");
      startTransition(() => {
        setDatasets((current) => ({ ...current, ...Object.fromEntries(loaded.map((item) => [item.key, item.rows])) }));
        setImports((current) => ({ ...current, ...Object.fromEntries(loaded.map((item) => [item.key, item.summary])) }));
        setImportHistory((current) => {
          const entries = loaded.map((item) => ({
            ...item.summary,
            id: taskId("import"),
            source: item.key,
            version: current.filter((entry) => entry.source === item.key).length + 1,
            previousRows: imports[item.key]?.rows || 0,
            warnings: item.warnings,
          }));
          return [...entries, ...current].slice(0, 80);
        });
      });
      loaded.forEach((item) => recordAudit("import", `${sourceConfig.find((source) => source.key === item.key)?.title || item.key}: ${item.summary.rows} linhas importadas${item.warnings ? `; ${item.warnings} validações pendentes` : ""}.`));
      setUploads({});
      const warnings = loaded.reduce((sum, item) => sum + item.warnings, 0);
      setMessage(`Carga validada e salva na base central. ${warnings ? `${warnings} validação(ões) precisa(m) de revisão no histórico.` : "Os visuais já usam as fontes importadas."}`);
      setActive("Visão geral");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível ler um dos arquivos.");
    } finally {
      setImporting(false);
      setImportProgress("");
    }
  }
  function addRoadDriver() {
    if (currentUser?.role !== "admin") return;
    const fullName = driverDraft.fullName.trim();
    const cpf = driverDraft.cpf.replace(/\D/g, "");
    if (!fullName || cpf.length !== 11) { setLogisticsMessage("Informe o nome completo e um CPF com 11 dígitos."); return; }
    if (logistics.drivers.some((driver) => driver.cpf === cpf)) { setLogisticsMessage("Já existe um motorista cadastrado com este CPF."); return; }
    setLogistics((current) => ({ ...current, drivers: [...current.drivers, { id: taskId("motorista"), fullName, cpf, phone: driverDraft.phone.trim(), createdAt: new Date().toISOString() }] }));
    setDriverDraft({ cpf: "", fullName: "", phone: "" });
    setLogisticsMessage("Motorista cadastrado para a configuração rodoviária.");
    recordAudit("workspace", `Motorista cadastrado: ${fullName}.`);
  }
  function addRoadVehicle() {
    if (currentUser?.role !== "admin") return;
    const plate = vehicleDraft.plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const capacity = Number(vehicleDraft.capacity.replace(",", "."));
    const model = vehicleDraft.model.trim();
    if (plate.length < 7 || !Number.isFinite(capacity) || capacity <= 0 || !model) { setLogisticsMessage("Informe placa, modelo e capacidade válida do veículo."); return; }
    if (logistics.vehicles.some((vehicle) => vehicle.plate === plate)) { setLogisticsMessage("Já existe um veículo cadastrado com esta placa."); return; }
    setLogistics((current) => ({ ...current, vehicles: [...current.vehicles, { id: taskId("veiculo"), plate, capacity, model, createdAt: new Date().toISOString() }] }));
    setVehicleDraft({ capacity: "", model: "", plate: "" });
    setLogisticsMessage("Veículo cadastrado para a configuração rodoviária.");
    recordAudit("workspace", `Veículo cadastrado: ${plate}.`);
  }
  function removeRoadDriver(driver: RoadDriver) {
    if (currentUser?.role !== "admin") return;
    if (logistics.trips.some((trip) => trip.driverId === driver.id)) { setLogisticsMessage("Este motorista já está vinculado a uma viagem e não pode ser excluído."); return; }
    setLogistics((current) => ({ ...current, drivers: current.drivers.filter((item) => item.id !== driver.id) }));
    recordAudit("workspace", `Motorista removido: ${driver.fullName}.`);
  }
  function removeRoadVehicle(vehicle: RoadVehicle) {
    if (currentUser?.role !== "admin") return;
    if (logistics.trips.some((trip) => trip.vehicleId === vehicle.id)) { setLogisticsMessage("Este veículo já está vinculado a uma viagem e não pode ser excluído."); return; }
    setLogistics((current) => ({ ...current, vehicles: current.vehicles.filter((item) => item.id !== vehicle.id) }));
    recordAudit("workspace", `Veículo removido: ${vehicle.plate}.`);
  }
  function addRouteItem() {
    if (!selectedRouteItem) { setLogisticsMessage("Selecione uma solicitação e um material para adicionar à rota."); return; }
    if (routeItems.some((item) => item.id === selectedRouteItem.id)) { setLogisticsMessage("Este material já foi adicionado à rota."); return; }
    setRouteItems((current) => [...current, selectedRouteItem]);
    setTripMaterialKey("");
    setLogisticsMessage(`${selectedRouteItem.product} adicionado à rota.`);
  }
  function removeRouteItem(id: string) {
    setRouteItems((current) => current.filter((item) => item.id !== id));
  }
  function createLogisticsTrip() {
    if (currentUser?.role !== "admin") return;
    const driver = logistics.drivers.find((item) => item.id === tripDriverId);
    const vehicle = logistics.vehicles.find((item) => item.id === tripVehicleId);
    const invoiceNumber = tripInvoiceNumber.trim();
    const primary = routeItems[0];
    if (!primary || !driver || !vehicle || !invoiceNumber) { setLogisticsMessage("Adicione ao menos um material à rota e informe motorista, veículo e nota fiscal."); return; }
    const sourceWarehouses = [...new Set(routeItems.map((item) => item.sourceWarehouse).filter(Boolean))];
    const destinations = [...new Set(routeItems.map((item) => item.destination).filter(Boolean))];
    const trip: LogisticsTrip = {
      id: taskId("viagem"),
      requestId: primary.requestId, requestDate: primary.requestDate, product: primary.product, productCode: primary.productCode,
      lot: primary.lot, quantity: primary.quantity, unit: primary.unit,
      sourceWarehouse: sourceWarehouses.join(" · "), destination: destinations.join(" · "), destinationCode: primary.destinationCode,
      driverId: driver.id, vehicleId: vehicle.id, invoiceNumber, createdAt: new Date().toISOString(), items: routeItems,
    };
    setLogistics((current) => ({ ...current, trips: [trip, ...current.trips] }));
    setRecipeTripId(trip.id);
    setTripRequestId("");
    setTripMaterialKey("");
    setRouteItems([]);
    setTripInvoiceNumber("");
    setLogisticsMessage(`Viagem ${trip.id.replace("viagem-", "")} emitida com ${routeItems.length} material(is) de ${new Set(routeItems.map((item) => item.requestId)).size} solicitação(ões). Agora vincule a receita, se aplicável.`);
    recordAudit("workspace", `Viagem emitida com ${routeItems.length} material(is) para ${new Set(routeItems.map((item) => item.requestId)).size} solicitação(ões).`);
  }
  function attachTripRecipe() {
    if (currentUser?.role !== "admin") return;
    const trip = logistics.trips.find((item) => item.id === recipeTripId);
    if (!trip || !recipeDraft.culture.trim() || !recipeDraft.target.trim() || !recipeDraft.dose.trim()) { setLogisticsMessage("Informe cultura, alvo e dose para vincular a receita."); return; }
    setLogistics((current) => ({ ...current, trips: current.trips.map((item) => item.id === trip.id ? { ...item, recipe: { culture: recipeDraft.culture.trim(), target: recipeDraft.target.trim(), dose: recipeDraft.dose.trim() } } : item) }));
    setRecipeDraft({ culture: "", dose: "", target: "" });
    setLogisticsMessage("Receita vinculada à viagem emitida.");
    recordAudit("workspace", `Receita vinculada à viagem ${trip.id.replace("viagem-", "")}.`);
  }
  function removeLogisticsTrip(trip: LogisticsTrip) {
    if (currentUser?.role !== "admin") return;
    const items = logisticsTripItems(trip);
    if (!window.confirm(`Excluir a viagem com ${items.length} material(is) de ${new Set(items.map((item) => item.requestId)).size} solicitação(ões)?`)) return;
    setLogistics((current) => ({ ...current, trips: current.trips.filter((item) => item.id !== trip.id) }));
    if (recipeTripId === trip.id) setRecipeTripId("");
    recordAudit("workspace", `Viagem excluída: ${items.length} material(is) e ${new Set(items.map((item) => item.requestId)).size} solicitação(ões).`);
  }
  async function exportLogisticsDocument(trip: LogisticsTrip) {
    const XLSX = await loadXlsx();
    const driver = logistics.drivers.find((item) => item.id === trip.driverId);
    const vehicle = logistics.vehicles.find((item) => item.id === trip.vehicleId);
    const rows = [
      ["Viagem", "Solicitação", "Data solicitação", "Armazém", "Cód. material", "Insumo web", "Lote", "Unidade", "Quantidade", "Destino", "Cód. destino", "Motorista", "CPF", "Placa", "Modelo", "Capacidade", "Nota fiscal", "Cultura", "Alvo", "Dose"],
      ...logisticsTripItems(trip).map((item) => [trip.id.replace("viagem-", ""), item.requestId, item.requestDate, item.sourceWarehouse, item.productCode, item.product, item.lot, item.unit, item.quantity, item.destination, item.destinationCode, driver?.fullName || "Motorista removido", driver?.cpf || "", vehicle?.plate || "Veículo removido", vehicle?.model || "", vehicle?.capacity || "", trip.invoiceNumber, trip.recipe?.culture || "", trip.recipe?.target || "", trip.recipe?.dose || ""]),
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Emissão de doc");
    XLSX.writeFile(workbook, `emissao_logistica_${trip.id.replace("viagem-", "")}.xlsx`, { bookType: "xlsx" });
  }
  function resetClosingDraft() {
    setEditingClosingId("");
    setClosingDraft({ supplier: "", paymentDue: "", destination: "", deliveryLocation: "", cycle: "Safra", culture: "", active: "", product: "", unit: "", currency: "BRL", unitPrice: "", packaging: "", totalVolume: "", orderKey: "" });
    setClosingDistributionDraft({});
  }
  function applyClosingOrder(orderKey: string) {
    const order = commercialOrders.find((item) => item.key === orderKey);
    setClosingDraft((current) => ({
      ...current,
      orderKey,
      supplier: order?.supplier || current.supplier,
      paymentDue: order?.dueDate ? (dateFromPlan(order.dueDate) ? dateKey(dateFromPlan(order.dueDate)!) : current.paymentDue) : current.paymentDue,
      active: order && order.active !== "Não conciliado" ? order.active : current.active,
      product: order?.product || current.product,
      unit: order?.unit || current.unit,
      currency: order?.currency || current.currency,
      unitPrice: order?.unitPrice ? String(order.unitPrice) : current.unitPrice,
    }));
  }
  function applyPlanningDistribution() {
    const volume = numberFrom(closingDraft.totalVolume);
    if (!selectedClosingSchedule?.planned || !volume) { setClosingMessage("Informe o produto e o volume para usar a sugestão baseada no planejamento."); return; }
    const distribution = Object.fromEntries(Object.entries(selectedClosingSchedule.months).map(([month, amount]) => [month, Number((volume * amount / selectedClosingSchedule.planned).toFixed(4))]));
    setClosingDistributionDraft(distribution);
    setClosingMessage("Distribuição sugerida pelo volume planejado em cada mês de aplicação.");
  }
  function saveCommercialClosing() {
    if (currentUser?.role !== "admin") return;
    const supplier = closingDraft.supplier.trim();
    const product = closingDraft.product.trim();
    const totalVolume = numberFrom(closingDraft.totalVolume);
    const unitPrice = numberFrom(closingDraft.unitPrice);
    const totalDistributed = Object.values(closingDistributionDraft).reduce((sum, amount) => sum + numberFrom(amount), 0);
    if (!supplier || !product || totalVolume <= 0 || unitPrice < 0) { setClosingMessage("Informe fornecedor, produto, volume e valor unitário para salvar o fechamento."); return; }
    if (Math.abs(totalDistributed - totalVolume) > 0.01) { setClosingMessage(`A distribuição mensal soma ${formatNumber(totalDistributed)} e precisa totalizar ${formatNumber(totalVolume)}.`); return; }
    const selectedOrder = commercialOrders.find((order) => order.key === closingDraft.orderKey);
    const now = new Date().toISOString();
    const item: CommercialClosing = {
      id: editingClosingId || taskId("fechamento"),
      supplier,
      paymentDue: closingDraft.paymentDue,
      destination: closingDraft.destination.trim(),
      deliveryLocation: closingDraft.deliveryLocation.trim(),
      cycle: closingDraft.cycle,
      culture: closingDraft.culture.trim(),
      active: closingDraft.active.trim() || dimensions.materials[normalizeMaterial(product)]?.principleActive || "Não informado",
      product,
      unit: closingDraft.unit.trim() || selectedOrder?.unit || "UN",
      currency: closingDraft.currency,
      unitPrice,
      packaging: closingDraft.packaging.trim(),
      totalVolume,
      distribution: Object.fromEntries(Object.entries(closingDistributionDraft).filter(([, amount]) => numberFrom(amount) !== 0).map(([month, amount]) => [month, numberFrom(amount)])),
      orderKey: selectedOrder?.key || "",
      orderNumber: selectedOrder?.orderNumber || "",
      createdAt: commercialClosings.closings.find((closing) => closing.id === editingClosingId)?.createdAt || now,
      updatedAt: now,
    };
    setCommercialClosings((current) => ({ ...current, closings: editingClosingId ? current.closings.map((closing) => closing.id === editingClosingId ? item : closing) : [item, ...current.closings] }));
    recordAudit("workspace", `${editingClosingId ? "Fechamento atualizado" : "Fechamento comercial criado"}: ${item.product}.`);
    setClosingMessage(editingClosingId ? "Fechamento atualizado e conciliado com a distribuição." : "Fechamento comercial salvo com a distribuição mensal.");
    resetClosingDraft();
    setClosingTab("distribuicoes");
  }
  function editCommercialClosing(closing: CommercialClosing) {
    setEditingClosingId(closing.id);
    setClosingDraft({ supplier: closing.supplier, paymentDue: closing.paymentDue, destination: closing.destination, deliveryLocation: closing.deliveryLocation, cycle: closing.cycle, culture: closing.culture, active: closing.active, product: closing.product, unit: closing.unit, currency: closing.currency, unitPrice: String(closing.unitPrice), packaging: closing.packaging, totalVolume: String(closing.totalVolume), orderKey: closing.orderKey });
    setClosingDistributionDraft(closing.distribution);
    setClosingMessage("");
    setClosingTab("distribuicoes");
  }
  function removeCommercialClosing(closing: CommercialClosing) {
    if (currentUser?.role !== "admin") return;
    if (!window.confirm(`Excluir o fechamento de ${closing.product} com ${closing.supplier}?`)) return;
    setCommercialClosings((current) => ({ ...current, closings: current.closings.filter((item) => item.id !== closing.id), annotations: current.annotations.filter((note) => note.closingId !== closing.id) }));
    if (editingClosingId === closing.id) resetClosingDraft();
    recordAudit("workspace", `Fechamento comercial excluído: ${closing.product}.`);
  }
  function saveClosingAnnotation() {
    if (currentUser?.role !== "admin") return;
    if (!closingAnnotationDraft.closingId || !closingAnnotationDraft.note.trim()) { setClosingMessage("Vincule a anotação a um fechamento e descreva o detalhe de faturamento ou observação."); return; }
    const annotation: ClosingAnnotation = {
      id: taskId("anotacao-fechamento"), closingId: closingAnnotationDraft.closingId, materialSent: closingAnnotationDraft.materialSent.trim(),
      purchaseVolume: closingAnnotationDraft.purchaseVolume.trim() ? numberFrom(closingAnnotationDraft.purchaseVolume) : null,
      invoicedVolume: closingAnnotationDraft.invoicedVolume.trim() ? numberFrom(closingAnnotationDraft.invoicedVolume) : null,
      note: closingAnnotationDraft.note.trim(), resolved: closingAnnotationDraft.resolved, createdAt: new Date().toISOString(),
    };
    setCommercialClosings((current) => ({ ...current, annotations: [annotation, ...current.annotations] }));
    setClosingAnnotationDraft({ closingId: "", materialSent: "", purchaseVolume: "", invoicedVolume: "", note: "", resolved: false });
    setClosingMessage("Anotação vinculada ao fechamento comercial.");
    recordAudit("workspace", "Anotação de faturamento incluída em um fechamento comercial.");
  }
  function removeClosingAnnotation(annotation: ClosingAnnotation) {
    if (currentUser?.role !== "admin") return;
    setCommercialClosings((current) => ({ ...current, annotations: current.annotations.filter((item) => item.id !== annotation.id) }));
  }
  function addPremise() {
    if (!draft.key.trim() || !draft.value.trim()) return;
    setDimensionPremises((current) => [...current, { ...draft, key: draft.key.trim(), value: draft.value.trim() }]);
    recordAudit("premise", `Premissa incluída: ${draft.domain} — ${draft.key.trim()}.`);
    setDraft((current) => ({ ...current, key: "", value: "" }));
  }
  async function exportPremiseSection() {
    const XLSX = await loadXlsx();
    const section = selectedPremiseSection;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([section.headers, ...section.rows]), section.title.slice(0, 31));
    XLSX.writeFile(workbook, `premissas_${section.id}_${dateKey(new Date())}.xlsx`, { bookType: "xlsx" });
  }
  function addLinkedTask() {
    if (!taskNote.trim()) return;
    const linked = pendingSignals.find((signal) => signal.id === taskPendingId);
    const material = taskLinkMode === "pedido" ? linked?.material || "" : taskMaterialLink;
    const nucleus = taskLinkMode === "pedido" ? linked?.nucleus || "" : "";
    const now = new Date().toISOString();
    setTasks((current) => [...current, {
      id: taskId("tarefa"),
      pendingId: taskLinkMode === "pedido" ? taskPendingId : "",
      material,
      nucleus,
      title: taskTitle.trim() || (material ? `Ação para ${material}${nucleus ? ` — ${nucleus}` : ""}` : "Ação operacional"),
      createdAt: now,
      owner: currentUser?.name || "Não atribuído",
      dueDate: dateKey(new Date(Date.now() + 3 * 86_400_000)),
      evidence: "",
      status: "Aberta",
      updatedAt: now,
      actions: [{ id: taskId("acao"), note: taskNote.trim(), createdAt: now }],
    }]);
    recordAudit("task", `Tarefa registrada: ${taskTitle.trim() || material || "Ação operacional"}.`);
    setTaskTitle("");
    setTaskNote("");
    setTaskPendingId("");
    setTaskMaterialLink("");
  }
  function appendTaskAction(taskIdValue: string) {
    const note = taskActionDrafts[taskIdValue]?.trim();
    if (!note) return;
    setTasks((current) => current.map((task) => task.id === taskIdValue ? {
      ...task,
      actions: [...task.actions, { id: taskId("acao"), note, createdAt: new Date().toISOString() }],
      updatedAt: new Date().toISOString(),
    } : task));
    setTaskActionDrafts((current) => ({ ...current, [taskIdValue]: "" }));
  }
  function updateTask(taskIdValue: string, patch: Partial<Pick<TaskItem, "owner" | "dueDate" | "evidence" | "status">>) {
    setTasks((current) => current.map((task) => task.id === taskIdValue ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task));
    if (patch.status) recordAudit("task", `Tarefa atualizada para ${patch.status}.`);
  }
  function deleteTask(task: TaskItem) {
    if (currentUser?.role !== "admin") return;
    if (!window.confirm(`Excluir a tarefa “${task.title}” e todo o seu histórico?`)) return;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    recordAudit("task", `Tarefa excluída: ${task.title}.`);
  }
  function openNotification() {
    const nucleus = taskNucleusFilter !== "Todos" && taskNuclei.includes(taskNucleusFilter) ? taskNucleusFilter : taskNuclei[1] ?? "Todos";
    setNotificationNucleus(nucleus);
    setNotificationTo(emailSettings.nucleusRecipients[nucleus] || "");
    setNotificationCc(emailSettings.defaultCopy || "");
    setNotificationMessage(null);
    setShowNotification(true);
  }
  function closeNotification() {
    notificationSourceRequest.current += 1;
    setNotificationSource(null);
    setNotificationSourceLoading(false);
    setShowNotification(false);
  }
  async function loadNotificationSource(file: File) {
    const request = ++notificationSourceRequest.current;
    setNotificationSourceLoading(true);
    setNotificationMessage(null);
    try {
      const { rows } = await parseImportFile(file, { key: "pedidos", header: 0 });
      if (!rows.length) throw new Error("A planilha não contém linhas de pedidos pendentes.");
      if (request === notificationSourceRequest.current) setNotificationSource({ name: file.name, rows });
    } catch (error) {
      if (request === notificationSourceRequest.current) {
        setNotificationMessage({ text: error instanceof Error ? error.message : "Não foi possível ler a planilha." });
      }
    } finally {
      if (request === notificationSourceRequest.current) setNotificationSourceLoading(false);
    }
  }
  async function copyNotificationBody() {
    if (!notificationDraft) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([notificationDraft.html], { type: "text/html" }),
        "text/plain": new Blob([notificationDraft.text], { type: "text/plain" }),
      })]);
      setNotificationMessage({ text: "Corpo copiado. Na nova mensagem do Outlook, cole no início do corpo, acima da assinatura.", success: true });
    } catch {
      setNotificationMessage({ text: "O navegador não permitiu copiar com formatação. Abra a prévia para copiar a mensagem ou baixe o arquivo .eml." });
    }
  }
  function downloadNotificationDraft() {
    if (!notificationRecipients?.length || !notificationCopy) {
      setNotificationMessage({ text: "Informe um destinatário válido e confira os endereços em cópia." });
      return;
    }
    if (!notificationDraft) return;

    const url = URL.createObjectURL(new Blob([
      buildOutlookEml(notificationDraft, notificationRecipients, notificationCopy),
    ], { type: "message/rfc822" }));
    const launcher = document.createElement("a");
    launcher.href = url;
    launcher.download = "controle-de-pedidos.eml";
    launcher.hidden = true;
    document.body.appendChild(launcher);
    launcher.click();
    launcher.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotificationMessage({ text: "Abra o arquivo .eml no Outlook. Para adicionar a sua assinatura, use Mensagem → Assinatura.", success: true });
  }
  async function exportTasks() {
    const XLSX = await loadXlsx();
    const farolRows = filteredPendingSignals.map((signal) => ({
      Farol: signal.status,
      Previsão: signal.dueDate ? new Intl.DateTimeFormat("pt-BR").format(signal.dueDate) : "Sem data",
      "Dias para uso": signal.daysUntil ?? "Sem cálculo",
      Pedido: signal.reference,
      Material: signal.material,
      Núcleo: signal.nucleus,
      "Volume solicitado": signal.quantity,
    }));
    const history = tasks.flatMap((task) => task.actions.map((action) => {
      const linked = pendingSignals.find((signal) => signal.id === task.pendingId);
      return { Tarefa: task.title, Status: task.status || "Aberta", Responsável: task.owner || "Não atribuído", Prazo: task.dueDate || "", Evidência: task.evidence || "", Pedido: linked?.reference || "", Material: linked?.material || task.material || "", Núcleo: linked?.nucleus || task.nucleus || "", Ação: action.note, "Registrada em": formatDateTime(action.createdAt) };
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(farolRows), "Farol de pedidos");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(history), "Histórico de ações");
    XLSX.writeFile(workbook, `tarefas_e_farol_${dateKey(new Date())}.xlsx`, { bookType: "xlsx" });
  }
  async function exportAlerts() {
    const XLSX = await loadXlsx();
    const alerts = filteredOperationalAlerts.map((alert) => ({ Categoria: alert.category, Prioridade: alert.severity === "critical" ? "Crítico" : alert.severity === "attention" ? "Atenção" : "Informativo", Título: alert.title, Detalhe: alert.detail, "Saldo armazém": alert.warehouseBalances?.map((location) => `${location.location}: ${formatNumber(location.amount)}`).join(" | ") || "—", Indicador: alert.metric }));
    const farolRows = pendingSignals.filter((signal) => signal.status !== "Programado" && signal.status !== "Sem data").map((signal) => ({ Farol: signal.status, Pedido: signal.reference, Material: signal.material, Núcleo: signal.nucleus, Previsão: signal.dueDate ? new Intl.DateTimeFormat("pt-BR").format(signal.dueDate) : "Sem data", "Volume solicitado": signal.quantity }));
    const warehouseRows = warehouseStockRelations.map((row) => ({ "Princípio ativo": row.active, Grupo: row.group, Subgrupo: row.subgroup, "Material padrão": row.standardMaterial, Material: row.material, Armazém: row.warehouse, Saldo: row.balance }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(alerts), "Alertas operacionais");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(farolRows), "Farol de pedidos");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(warehouseRows), "Saldo em armazém");
    XLSX.writeFile(workbook, `alertas_operacionais_${dateKey(new Date())}.xlsx`, { bookType: "xlsx" });
  }
  async function exportProvision() {
    const XLSX = await loadXlsx();
    const summary = provision.rows.map((row) => ({
      "Núcleo": row.nucleus, "Princípio ativo": row.active, Grupo: row.merchandiseGroup, Subgrupo: row.subgroup,
      "Material padrão": row.standardMaterial, "Demanda da janela": row.demand, "Saldo do núcleo": row.farmBalance,
      Trânsito: row.transit, "Apoio do armazém": row.warehouseSupport, "Apoio de outros núcleos": row.nucleusSupport, "Saldo após atendimento": row.balance,
      "Volume solicitado": row.pendingOrder, Situação: row.status,
    }));
    const details = provision.rows.flatMap((row) => [
      ...row.locations.filter((location) => location.type !== "Armazém").map((location) => ({
        "Núcleo": row.nucleus, "Material padrão": row.standardMaterial, Material: location.material, Tipo: location.type, Local: location.location, "Saldo / trânsito": location.amount,
      })),
      ...row.warehouseLocations.map((location) => ({
        "Núcleo": row.nucleus, "Material padrão": row.standardMaterial, Material: location.material, Tipo: "Armazém", Local: location.location, "Saldo / trânsito": location.amount,
      })),
      ...row.nucleusSupportLocations.map((location) => ({
        "Núcleo": row.nucleus, "Material padrão": row.standardMaterial, Material: location.material, Tipo: "Apoio de outro núcleo", Local: location.location, "Saldo / trânsito": location.amount,
      })),
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), "Resumo");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(details), "Detalhes");
    XLSX.writeFile(workbook, "provisionamento_" + evaluationDate + "_" + provisionUntil + ".xlsx", { bookType: "xlsx" });
  }
  async function exportMonitoring() {
    const XLSX = await loadXlsx();
    const totalsByActive = monitoringGroups.map((group) => ({
      "Princípio ativo": group.active,
      "Qtd. planejada": group.totals.planned,
      Saldo: group.totals.balance,
      Trânsito: group.totals.transit,
      Aplicado: group.totals.applied,
      "A entregar": group.totals.toDeliver,
      "Volume solicitado": group.totals.pendingOrder,
    }));
    const summary = executionRows.map((row) => {
      const conversion = stockConversionBalances.get(row.id);
      return {
        "Princípio ativo": row.active,
        Ciclo: row.cycles.join(", "),
        Cultura: row.cultures.join(", "),
        Núcleo: row.nucleus,
        Grupo: row.merchandiseGroup,
        Subgrupo: row.subgroup,
        "Material padrão": row.standardMaterial,
        "Material em estoque": row.stockMaterials.join(", "),
        "Qtd. planejada": row.planned,
        Estoque: row.farmBalance + row.warehouseBalance,
        "Saldo físico sem conversão": conversion?.hasConversion ? conversion.physical : "",
        Trânsito: row.transit,
        Aplicado: row.applied,
        "A entregar": amountToDeliver(row),
        "Volume solicitado": row.pendingOrder,
      };
    });
    const details = executionRows.flatMap((row) => consolidateLocations(row.locations).map((location) => ({
      "Princípio ativo": row.active,
      Núcleo: row.nucleus,
      "Material padrão": row.standardMaterial,
      Material: location.material,
      Tipo: location.type,
      Localização: location.location,
      "Saldo / trânsito": location.amount,
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), "Acompanhamento");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(totalsByActive), "Totais por ativo");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(details), "Detalhes");
    XLSX.writeFile(workbook, "acompanhamento_" + dateKey(new Date()) + ".xlsx", { bookType: "xlsx" });
  }
  async function exportReconciliationReport() {
    const XLSX = await loadXlsx();
    const rows = reconciliationIssues.map((issue) => ({
      Fonte: issue.source,
      Material: issue.material,
      "Código SAP": issue.code,
      Ocorrências: issue.count,
      Diagnóstico: issue.detail,
      "Ação sugerida": issue.action,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Não conciliados");
    XLSX.writeFile(workbook, "relatorio_conciliacao_" + dateKey(new Date()) + ".xlsx", { bookType: "xlsx" });
  }

  const dashboardLedger = operatorNucleus ? ledger.filter((row) => row.nucleus === operatorNucleus) : ledger;
  const totalPlanned = dashboardLedger.reduce((sum, row) => sum + row.planned, 0);
  const totalApplied = dashboardLedger.reduce((sum, row) => sum + row.applied, 0);
  const shortage = isOperator ? dashboardLedger.reduce((sum, row) => sum + row.shortage, 0) : consolidatedSupply.shortage;
  const hasData = sourceConfig.some((source) => Boolean(imports[source.key]));
  const scopedTasks = isOperator
    ? tasks.filter((task) => task.nucleus === operatorNucleus || scopedPendingSignals.some((signal) => signal.id === task.pendingId))
    : tasks;
  const openTasks = scopedTasks.filter((task) => task.status !== "Concluída");
  const overdueTasks = openTasks.filter((task) => task.dueDate && task.dueDate < dateKey(new Date(clock))).length;
  const taskHistory = scopedTasks.flatMap((task) => task.actions.map((action) => ({ ...action, task }))).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const taskHistoryPages = Math.max(1, Math.ceil(taskHistory.length / taskHistorySize));
  const safeTaskHistoryPage = Math.min(taskHistoryPage, taskHistoryPages - 1);
  const paginatedTaskHistory = taskHistory.slice(safeTaskHistoryPage * taskHistorySize, (safeTaskHistoryPage + 1) * taskHistorySize);
  const qualityWarnings = importHistory.reduce((sum, item) => sum + item.warnings, 0);
  const qualityPending = reconciliationIssues.length + qualityWarnings;
  const dashboardQualityPending = isOperator ? 0 : qualityPending;
  const dailyPriorities = [
    ...scopedOperationalAlerts.filter((alert) => alert.severity === "critical").slice(0, 4).map((alert) => ({ id: alert.id, level: "Crítico", title: alert.title, detail: alert.detail, tone: "rose" })),
    ...scopedPendingSignals.filter((signal) => signal.status === "Alerta" || signal.status === "Ponto de atenção").slice(0, 4).map((signal) => ({ id: signal.id, level: signal.status, title: `${signal.material} — ${signal.nucleus}`, detail: `${signal.reference} · ${signal.dueDate ? new Intl.DateTimeFormat("pt-BR").format(signal.dueDate) : "sem data"}`, tone: signal.tone === "rose" ? "rose" : "amber" })),
    ...openTasks.filter((task) => task.dueDate && task.dueDate <= dateKey(new Date(clock))).slice(0, 3).map((task) => ({ id: task.id, level: "Tarefa", title: task.title, detail: `${task.owner || "Não atribuído"} · prazo ${task.dueDate ? new Intl.DateTimeFormat("pt-BR").format(new Date(task.dueDate + "T00:00:00")) : "não definido"}`, tone: "amber" })),
  ].slice(0, 8);

  async function exportExecutiveReport() {
    const XLSX = await loadXlsx();
    const workbook = XLSX.utils.book_new();
    const overview = [
      { Indicador: "Execução de materiais", Valor: `${percent(totalApplied, totalPlanned).toFixed(1)}%`, Detalhe: `${formatNumber(totalApplied)} de ${formatNumber(totalPlanned)} planejados` },
      { Indicador: "Saldo com atenção", Valor: shortage, Detalhe: "Necessidade após rateio e apoios" },
      { Indicador: "Pendências de qualidade", Valor: qualityPending, Detalhe: `${reconciliationIssues.length} de conciliação e ${qualityWarnings} de importação` },
      { Indicador: "Tarefas abertas", Valor: openTasks.length, Detalhe: `${overdueTasks} em atraso` },
    ];
    const supply = provision.rows.map((row) => ({ Núcleo: row.nucleus, Material: row.standardMaterial, Demanda: row.demand, Fazenda: row.farmBalance, Trânsito: row.transit, Armazém: row.warehouseSupport, "Outros núcleos": row.nucleusSupport, Situação: row.status }));
    const taskRows = scopedTasks.map((task) => ({ Tarefa: task.title, Status: task.status || "Aberta", Responsável: task.owner || "Não atribuído", Prazo: task.dueDate || "", Material: task.material || "", Núcleo: task.nucleus || "", Atualizada: formatDateTime(task.updatedAt || task.createdAt) }));
    const daeRows = daeByNucleus.flatMap(({ nucleus, entries }) => entries.map((entry) => ({ Núcleo: nucleus, Cultura: entry.culture, Ciclo: entry.cycle, DAE: entry.days, "Data de plantio": new Intl.DateTimeFormat("pt-BR").format(entry.plantedAt), Área: entry.area, "% da área": entry.share })));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(overview), "Resumo executivo");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(dailyPriorities), "Prioridades do dia");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(supply), "Simulação logística");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(taskRows), "Tarefas");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(daeRows), "DAE por núcleo");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(reconciliationIssues), "Qualidade da base");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(importHistory), "Histórico de importação");
    XLSX.writeFile(workbook, `relatorio_executivo_${dateKey(new Date())}.xlsx`, { bookType: "xlsx" });
  }

  let content: ReactNode;
  if (active === "Visão geral") {
    content = hasData ? <section className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        <Card label="Execução de materiais" value={percent(totalApplied, totalPlanned).toFixed(1) + "%"} note={formatNumber(totalApplied) + " de " + formatNumber(totalPlanned) + " planejados"} tone="emerald" />
        <Card label="Saldo com atenção" value={formatNumber(shortage)} note="Necessidade após rateio do armazém" tone={shortage ? "amber" : "slate"} />
        <Card label="Pedidos pendentes" value={formatNumber(pendingOrders.reduce((sum, row) => sum + standardQuantity(row, "pending", productFor(row, "pending", dimensions), dimensions), 0))} note={pendingOrders.length ? String(pendingOrders.length) + " linhas de pedido" : "Importe na guia Importações"} />
      </div>
      <p className={cn("-mt-2 text-xs", materialResolution.described > materialResolution.resolved ? "text-amber-800" : "text-slate-500")}>Conciliação de materiais: {materialResolution.described ? `${materialResolution.resolved}/${materialResolution.described} descrições vinculadas pelas dimensões.` : "aguardando descrições importadas."}</p>
      <div className="grid gap-5 xl:grid-cols-2">{groupedProgress.map((group) => <div className="rounded-2xl border border-slate-200 bg-white p-5" key={group.cycle}><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Execução por subgrupo — {group.cycle}</h2><p className="mt-1 text-xs text-slate-500">Planejado x aplicado, separado por grupo e subgrupo.</p></div><BarChart3 className="h-5 w-5 text-emerald-700" /></div><div className="space-y-4">{group.rows.length ? group.rows.map((row) => <div key={row.group + "|" + row.subgroup}><div className="mb-1.5 flex items-end justify-between gap-3"><p className="text-sm font-medium">{row.subgroup} <span className="text-xs font-normal text-slate-500">{row.group}</span></p><p className="text-xs font-semibold text-slate-700">{percent(row.applied, row.planned).toFixed(1)}%</p></div><Progress value={percent(row.applied, row.planned)} /><p className="mt-1 text-xs text-slate-500">{formatNumber(row.applied)} aplicado de {formatNumber(row.planned)} planejado</p></div>) : <p className="py-8 text-center text-sm text-slate-500">Sem linhas conciliadas para este ciclo.</p>}</div></div>)}</div>
      <section className="border-t border-slate-200 pt-6"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold tracking-tight">Execução por cultura</h2><p className="mt-1 text-xs text-slate-500">Área registrada no ZPS007, por safra e safrinha.</p></div><p className="text-xs font-semibold text-slate-500">Leitura macro</p></div><div className="grid divide-y divide-slate-200 border-y border-slate-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">{macroCrop.map((crop) => <div className="px-0 py-4 sm:px-4 sm:first:pl-0 xl:first:pl-0" key={crop.code}><p className="text-xs font-semibold text-emerald-800">{crop.cycle}</p><div className="mt-2 flex items-end justify-between gap-3"><p className="font-bold text-slate-800">{crop.name}</p><p className="text-lg font-bold tabular-nums text-emerald-950">{formatNumber(crop.applied)}</p></div><p className="mt-1 text-xs text-slate-500">área executada registrada</p></div>)}</div></section>
      {daeByNucleus.length ? <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">DAE por núcleo</h2><p className="mt-1 text-xs text-slate-500">Idade desde o plantio. A área considera somente Planejamento: Classificação Atividade e Atividade Plantio sem adubo.</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">Ciclo: {dashboardSettings.daeCycle}</span></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{daeByNucleus.map(({ nucleus, entries }) => <article className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={nucleus}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Núcleo</p><h3 className="mt-1 font-semibold">{nucleus}</h3></div><div className="rounded-lg bg-white px-3 py-2 text-right shadow-sm"><p className="text-xl font-bold text-emerald-800">{entries[0]?.days} DAE</p><p className="text-[10px] text-slate-500">mais antigo</p></div></div><div className="mt-4 space-y-3">{entries.slice(0, 4).map((entry) => <div className="border-t border-slate-200 pt-3" key={[entry.culture, entry.cycle, dateKey(entry.plantedAt)].join("|")}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{entry.culture}</p><p className="text-xs text-slate-500">{entry.cycle} · plantio em {new Intl.DateTimeFormat("pt-BR").format(entry.plantedAt)}</p></div><p className="text-right text-sm font-bold text-slate-800">{entry.days} DAE<br /><span className="text-xs font-normal text-slate-500">{formatNumber(entry.area)} ha · {entry.share.toFixed(1)}%</span></p></div></div>)}{entries.length > 4 ? <p className="text-xs text-slate-500">+ {entries.length - 4} datas de plantio neste núcleo</p> : null}</div></article>)}</div></div> : <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500">A visão DAE será ativada quando o Planejamento contiver a data de plantio reconhecida para o ciclo selecionado.</div>}
      {materialResolution.described > materialResolution.resolved ? <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p><strong>Conciliação incompleta:</strong> {materialResolution.described - materialResolution.resolved} descrições não estão nas dimensões. Elas são identificadas, mas nunca viram uma chave pelo código SAP.</p></div> : null}
    </section> : <Empty actionLabel="Abrir central de importações" description="Carregue Planejamento, CN52, ZMM_BATCH, MB52 e MB5T. Depois envie Dimensões para conciliar materiais pelo nome." onAction={() => setActive("Importações")} title="Prepare a base para a conciliação" />;
  } else if (active === "Calendarização") {
    content = <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-semibold">Calendarização e provisionamento</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">A janela compara demanda planejada, saldo por núcleo, trânsito e apoio do armazém para o mesmo material.</p></div><button className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60" disabled={!plans.length} onClick={() => setShowProvision(true)} type="button"><CalendarDays className="h-4 w-4" />Rodar provisionamento</button></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><Card label="Data de avaliação" value={new Intl.DateTimeFormat("pt-BR").format(new Date(evaluationDate + "T00:00:00"))} note="Valor inicial editável" /><Card label="Horizonte padrão" value={premises.horizon} note="dias definidos nas premissas" /><Card label="Materiais com falta" value={consolidatedSupply.failures.length} note="após rateio do armazém" tone="amber" /></div></section>;
  } else if (active === "Acompanhamento") {
    content = monitoringLedger.length ? <section className="space-y-4">
      <div>
        <h2 className="font-semibold">Acompanhamento de materiais</h2>
        <p className="mt-1 text-sm text-slate-500">A visão inicia em Safra. O planejamento é recalculado para o ciclo selecionado; armazéns ficam separados do saldo de fazenda e podem ser detalhados por material e localização.</p>
      </div>
      <AnalysisFilters
        cultures={filters.cultures}
        cultureFilter={cultureFilter}
        cycleFilter={cycleFilter}
        cycles={filters.cycles}
        groupFilter={groupFilter}
        groups={filters.groups}
        onCultureChange={setCultureFilter}
        onCycleChange={setCycleFilter}
        onGroupChange={setGroupFilter}
        onNucleusChange={setNucleusFilter}
        onQueryChange={setQuery}
        onSubgroupChange={setSubgroupFilter}
        nuclei={monitoringNuclei}
        nucleusFilter={nucleusFilter}
        query={query}
        subgroupFilter={subgroupFilter}
        subgroups={filters.subgroups}
      />
      <div className="flex justify-end"><button className="inline-flex items-center gap-2 rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700" onClick={exportMonitoring} type="button"><Download className="h-4 w-4" />Exportar Excel</button></div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1300px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>{["", "Princípio ativo", "Ciclo / cultura", "Núcleo", "Material padrão", "Material em estoque", "Qtd. planejada", "Estoque", "Trânsito", "Aplicado", "A entregar", "V. solicitado"].map((head) => <th className="px-3 py-3 font-semibold" key={head}>{head}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {monitoringGroups.map((group) => <Fragment key={group.active}>
              <tr className="bg-emerald-50/70 text-emerald-950">
                <td className="px-3 py-2.5 font-semibold" colSpan={12}>Princípio ativo: {group.active}</td>
              </tr>
              {group.rows.map((row) => {
                const conversion = stockConversionBalances.get(row.id);
                const convertedBalance = row.farmBalance + row.warehouseBalance;
                return <Fragment key={row.id}>
                <tr>
                  <td className="px-3 py-3"><button aria-label="Expandir materiais" className="rounded border border-slate-200 p-1 text-slate-600" onClick={() => setExpanded(expanded === row.id ? null : row.id)} type="button"><ChevronDown className={cn("h-3.5 w-3.5", expanded === row.id && "rotate-180")} /></button></td>
                  <td className="px-3 py-3 text-slate-400">—</td>
                  <td className="px-3 py-3">{row.cycles.join(", ") || "—"}<br /><span className="text-xs text-slate-500">{row.cultures.join(", ") || "Sem cultura"}</span></td>
                  <td className={cn("px-3 py-3", row.isWarehouseView && "font-semibold text-emerald-800")}>{row.nucleus}</td>
                  <td className="px-3 py-3 font-medium">{row.standardMaterial}</td>
                  <td className="px-3 py-3">{row.stockMaterials.join(", ") || "—"}</td>
                  <td className="px-3 py-3">{formatNumber(row.planned)}</td>
                  <td className="px-3 py-3">{conversion?.hasConversion ? <><span className="inline-flex rounded-md bg-emerald-100 px-2 py-1 font-bold text-emerald-900">{formatNumber(convertedBalance)}</span><span className="mt-1 block text-[11px] text-slate-500">saldo físico: {formatNumber(conversion.physical)}</span></> : formatNumber(convertedBalance)}</td>
                  <td className="px-3 py-3">{formatNumber(row.transit)}</td>
                  <td className="px-3 py-3">{formatNumber(row.applied)}</td>
                  <td className={cn("px-3 py-3 font-semibold", amountToDeliverColor(amountToDeliver(row)))}>{formatNumber(amountToDeliver(row))}</td>
                  <td className="px-3 py-3 font-semibold text-emerald-700">{formatNumber(row.pendingOrder)}</td>
                </tr>
                {expanded === row.id ? <tr><td className="bg-emerald-50 px-5 py-4 text-xs text-emerald-950" colSpan={12}><StockDetails physicalBalances={stockLocationConversionBalances} row={row} /></td></tr> : null}
              </Fragment>;
              })}
              <tr className="border-y border-emerald-200 bg-emerald-50/50 font-semibold text-slate-800">
                <td className="px-3 py-3" colSpan={6}>Total — {group.active}</td>
                <td className="px-3 py-3">{formatNumber(group.totals.planned)}</td>
                <td className="px-3 py-3">{formatNumber(group.totals.balance)}</td>
                <td className="px-3 py-3">{formatNumber(group.totals.transit)}</td>
                <td className="px-3 py-3">{formatNumber(group.totals.applied)}</td>
                <td className={cn("px-3 py-3", amountToDeliverColor(group.totals.toDeliver))}>{formatNumber(group.totals.toDeliver)}</td>
                <td className="px-3 py-3 text-emerald-700">{formatNumber(group.totals.pendingOrder)}</td>
              </tr>
            </Fragment>)}
            {!executionRows.length ? <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={12}>Nenhum material atende aos filtros.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section> : <Empty title="Sem acompanhamento conciliado" description="Importe planejamento, consumo, estoque por lote, MB52 complementar e trânsito para ativar esta visão." />;
  } else if (active === "Execução") {
    content = executionPerformance.length ? <section className="space-y-5">
      <div>
        <h2 className="font-semibold">Execução de volumes e doses</h2>
        <p className="mt-1 text-sm text-slate-500">A leitura vincula CN52 à área executada do ZPS007 pelo Diagrama e Operação, sem usar o código SAP como chave de material.</p>
      </div>
      <AnalysisFilters
        cultures={filters.cultures}
        cultureFilter={cultureFilter}
        cycleFilter={cycleFilter}
        cycles={filters.cycles}
        groupFilter={groupFilter}
        groups={filters.groups}
        onCultureChange={setCultureFilter}
        onCycleChange={setCycleFilter}
        onGroupChange={setGroupFilter}
        onQueryChange={setQuery}
        onSubgroupChange={setSubgroupFilter}
        query={query}
        subgroupFilter={subgroupFilter}
        subgroups={filters.subgroups}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <Card label="% do planejamento executado" value={percentageText(performanceSummary.applied, performanceSummary.planned)} note={formatNumber(performanceSummary.applied) + " executado de " + formatNumber(performanceSummary.planned) + " planejado"} tone="emerald" />
        <Card label="Dose utilizada" value={formatDose(performanceSummary.appliedDose)} note={performanceSummary.plannedDose === null ? "Área ainda não conciliada" : "Planejado: " + formatDose(performanceSummary.plannedDose)} tone="emerald" />
        <Card label="Impacto da mudança de dose" value={signedNumber(performanceSummary.impact)} note={performanceSummary.impact > 0 ? "volume adicional na área executada" : performanceSummary.impact < 0 ? "volume abaixo do planejado" : "sem variação nas áreas conciliadas"} tone={performanceSummary.impact > 0 ? "amber" : "slate"} />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1380px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>{["Princípio ativo", "Ciclo / cultura", "Grupo / subgrupo", "Núcleo", "Material padrão", "% executado", "Planejado", "Executado", "Área executada", "Dose: executado | planejado", "Impacto de volume"].map((head) => <th className="px-3 py-3 font-semibold" key={head}>{head}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {performanceRows.map((row) => <tr key={row.id}>
              <td className="px-3 py-3 font-medium">{row.active}</td>
              <td className="px-3 py-3">{row.cycles.join(", ") || "—"}<br /><span className="text-xs text-slate-500">{row.cultures.join(", ") || "Sem cultura"}</span></td>
              <td className="px-3 py-3">{row.merchandiseGroup}<br /><span className="text-xs text-slate-500">{row.subgroup}</span></td>
              <td className="px-3 py-3">{row.nucleus}</td>
              <td className="px-3 py-3 font-medium">{row.standardMaterial}</td>
              <td className="px-3 py-3 font-semibold text-emerald-700">{percentageText(row.appliedVolume, row.plannedVolume)}</td>
              <td className="px-3 py-3">{formatNumber(row.plannedVolume)}</td>
              <td className="px-3 py-3">{formatNumber(row.appliedVolume)}</td>
              <td className="px-3 py-3">{row.appliedArea > 0 ? formatNumber(row.appliedArea) : "Área não conciliada"}</td>
              <td className="px-3 py-3">{row.appliedDose === null || row.plannedDose === null ? "Área não conciliada" : "Executado (" + formatDose(row.appliedDose) + ") | Planejado (" + formatDose(row.plannedDose) + ")"}</td>
              <td className={cn("px-3 py-3 font-semibold", (row.volumeImpact || 0) > 0 ? "text-amber-700" : (row.volumeImpact || 0) < 0 ? "text-emerald-700" : "text-slate-600")}>{signedNumber(row.volumeImpact)}</td>
            </tr>)}
            {!performanceRows.length ? <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={11}>Nenhum material atende aos filtros.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">Impacto de volume = volume executado − (dose planejada × área executada). Quando não houver correspondência de área, a dose fica indisponível em vez de assumir zero.</p>
    </section> : <Empty title="Sem dados de execução" description="Importe Planejamento, CN52 e ZPS007 para calcular volumes, área e dose." />;
  } else if (active === "Importações") {
    if (importing) {
      content = <ContentLoading detail={importProgress || "Preparando a importação em segundo plano."} />;
    } else {
    content = <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-5"><h2 className="font-semibold">Central de importações</h2><p className="mt-1 text-xs text-slate-500">As fontes são conciliadas e salvas na base central vinculada à sua conta. Este navegador mantém somente as preferências locais; os dados operacionais vêm da base central.</p></div>
      <div className="p-6">
        <div className={cn("rounded-2xl border p-5", dataFreshness.tone === "emerald" ? "border-emerald-200 bg-emerald-50/60" : dataFreshness.tone === "amber" ? "border-amber-200 bg-amber-50/60" : dataFreshness.tone === "rose" ? "border-rose-200 bg-rose-50/60" : "border-slate-200 bg-slate-50")}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">Atualização dos dados</p><p className="mt-1 text-2xl font-bold">{oldestSource ? `Este visual está ${elapsedLabel(oldestSource[1].fileModifiedAt, clock)} sem atualização.` : "Aguardando a primeira fonte operacional."}</p><p className="mt-1 text-xs text-slate-600">Considera o arquivo operacional mais antigo: {oldestSource ? `${sourceConfig.find((source) => source.key === oldestSource[0])?.title} — ${formatDateTime(oldestSource[1].fileModifiedAt)}` : "importe as fontes operacionais para iniciar a avaliação"}. Planejamento e dimensões não entram no critério de atraso.</p></div><span className={cn("rounded-full px-3 py-1 text-xs font-bold", dataFreshness.tone === "emerald" ? "bg-emerald-700 text-white" : dataFreshness.tone === "amber" ? "bg-amber-500 text-amber-950" : dataFreshness.tone === "rose" ? "bg-rose-700 text-white" : "bg-slate-200 text-slate-700")}>{dataFreshness.label}</span></div>
          <p className="mt-3 text-xs text-slate-600">Até 12 horas: OK · de 12 horas a 2 dias: Em atenção · acima de 2 dias: Necessita atualizar.</p>
        </div>
      </div>
        <div className="grid gap-3 px-6 pb-6 md:grid-cols-2">{sourceConfig.map((source) => <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 hover:border-emerald-300" key={source.key}><input accept=".xlsx,.xls" className="sr-only" onChange={(event) => setUploads((current) => ({ ...current, [source.key]: event.target.files?.[0] }))} type="file" /><div className="flex items-center gap-3"><FileUp className="h-5 w-5 text-emerald-700" /><div><p className="text-sm font-semibold">{source.title}</p><p className="text-xs text-slate-500">{imports[source.key]?.fileName || uploads[source.key]?.name || source.hint}</p>{imports[source.key] ? <p className="mt-1 text-[11px] text-slate-500">Modificado: {formatDateTime(imports[source.key]?.fileModifiedAt)}</p> : null}</div></div><span className="text-xs font-semibold text-emerald-700">{imports[source.key] ? "Importado" : uploads[source.key] ? "Selecionado" : "Selecionar"}</span></label>)}<DimensionUpload count={Object.keys(bundle.materials).length} label={imports.dimensoes?.fileName || "Dimensões.xlsx (opcional)"} onLoaded={(loaded, summary) => { setBundle(loaded); setImports((current) => ({ ...current, dimensoes: summary })); setMessage("Dimensões aplicadas e salvas na base central."); }} /></div>
      <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-600">{persistenceError || message || (storageReady ? "Cada fonte importada alimenta os visuais e fica salva na base central." : "Recuperando dados salvos na base central...")}</p><button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60" disabled={importing} onClick={importFiles} type="button"><Upload className="mr-2 inline h-4 w-4" />{importing ? "Importando..." : "Validar e importar"}</button></div>
      {Object.keys(imports).length ? <div className="border-t border-slate-100 p-6"><Table headers={["Fonte", "Arquivo", "Modificado em", "Importado em", "Linhas", "Abas"]} rows={[...sourceConfig.map((source) => [source.title, imports[source.key]?.fileName || "—", formatDateTime(imports[source.key]?.fileModifiedAt), formatDateTime(imports[source.key]?.importedAt), String(imports[source.key]?.rows ?? "—"), imports[source.key]?.sheets.join(", ") || "—"]), ["Dimensões / Princípio ativo", imports.dimensoes?.fileName || "—", formatDateTime(imports.dimensoes?.fileModifiedAt), formatDateTime(imports.dimensoes?.importedAt), String(imports.dimensoes?.rows ?? "—"), imports.dimensoes?.sheets.join(", ") || "—"]]} /></div> : null}
      {Object.keys(imports).length ? <div className="border-t border-slate-100 p-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Relatório de conciliação</h3><p className="mt-1 text-xs text-slate-500">Materiais, descrições e núcleos que precisam de ajuste nas dimensões.</p></div><button className="inline-flex items-center gap-2 rounded-lg border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:opacity-50" disabled={!reconciliationIssues.length} onClick={exportReconciliationReport} type="button"><Download className="h-4 w-4" />Exportar relatório</button></div><Table empty="Nenhuma pendência de conciliação nas fontes importadas." headers={["Fonte", "Material", "Código SAP", "Ocorrências", "Diagnóstico", "Ação sugerida"]} rows={reconciliationIssues.map((issue) => [issue.source, issue.material, issue.code, String(issue.count), issue.detail, issue.action])} /></div> : null}
    </section>;
    }
  } else if (active === "Alertas") {
    const alertStyle = {
      attention: "border-amber-200 bg-amber-50 text-amber-950",
      critical: "border-rose-200 bg-rose-50 text-rose-950",
      info: "border-sky-200 bg-sky-50 text-sky-950",
    };
    const alertLabel = { attention: "Atenção", critical: "Crítico", info: "Informativo" };
    content = <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Alertas operacionais</h2><p className="mt-1 text-sm text-slate-500">Prioridades calculadas a partir do planejamento, saldo por localização, execução e validade dos lotes.</p></div><button className="inline-flex items-center gap-2 rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700" onClick={exportAlerts} type="button"><Download className="h-4 w-4" />Exportar Excel</button></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card label="Repasse em até 30 dias" value={scopedAlertCounts.supply} note="sem saldo na fazenda" tone={scopedAlertCounts.supply ? "amber" : "slate"} />
        <Card label="Aumento de dose > 5%" value={scopedAlertCounts.dose} note="comparado ao planejado" tone={scopedAlertCounts.dose ? "amber" : "slate"} />
        <Card label="Estoque vencido" value={scopedAlertCounts.expired} note="fazenda e armazém" tone={scopedAlertCounts.expired ? "rose" : "slate"} />
        <Card label="Farol crítico" value={farol.alert} note="pedidos pendentes há mais de 5 dias" tone={farol.alert ? "rose" : "slate"} />
      </div>
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-xs font-semibold text-slate-600">Núcleo<select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => setAlertNucleusFilter(event.target.value)} value={alertNucleusFilter}>{alertNuclei.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">Material<input className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => setAlertMaterialFilter(event.target.value)} placeholder="Digite para filtrar" value={alertMaterialFilter} /></label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">Grupo<select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => setAlertGroupFilter(event.target.value)} value={alertGroupFilter}>{alertGroups.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">Subgrupo<select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => setAlertSubgroupFilter(event.target.value)} value={alertSubgroupFilter}>{alertSubgroups.map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      {filteredOperationalAlerts.length ? <div className="grid gap-3">{filteredOperationalAlerts.map((alert) => <article className={cn("rounded-2xl border p-4", alertStyle[alert.severity])} key={alert.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide opacity-70">{alert.category}</p><h3 className="mt-1 font-semibold">{alert.title}</h3><p className="mt-2 max-w-4xl text-sm leading-relaxed">{alert.detail}</p>{alert.warehouseBalances?.length ? <div className="mt-4 max-w-4xl border-t border-current/15 pt-3"><p className="text-xs font-bold uppercase tracking-wide opacity-75">Saldo armazém</p><div className="mt-2 grid gap-1 text-sm font-semibold sm:grid-cols-2">{alert.warehouseBalances.map((location) => <p key={`${alert.id}|${location.location}`}>{location.location} <span className="tabular-nums">— {formatNumber(location.amount)}</span></p>)}</div></div> : null}</div><span className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold">{alertLabel[alert.severity]} · {alert.metric}</span></div></article>)}</div> : <Empty title="Nenhum alerta atende aos filtros" description="Ajuste núcleo, material, grupo ou subgrupo para consultar outro recorte." />}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><p className="font-semibold text-slate-800">Sinalização na plataforma</p><p className="mt-1">Os riscos acima ficam destacados neste painel e no menu lateral. Para notificar pedidos por núcleo, use a ação de e-mail na guia Tarefas.</p></div>
    </section>;
  } else if (active === "Tarefas") {
    const signalStyle = {
      emerald: "bg-emerald-100 text-emerald-800", sky: "bg-sky-100 text-sky-800", amber: "bg-amber-100 text-amber-900", rose: "bg-rose-100 text-rose-800", slate: "bg-slate-100 text-slate-700",
    };
    content = <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Farol de pedidos pendentes</h2><p className="mt-1 text-sm text-slate-500">A data DtRemPed indica a previsão de utilização na fazenda e orienta a prioridade da equipe responsável.</p></div><div className="flex flex-wrap gap-2"><button className="inline-flex items-center gap-2 rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700" onClick={exportTasks} type="button"><Download className="h-4 w-4" />Exportar Excel</button><button className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white" onClick={openNotification} type="button"><Bell className="h-4 w-4" />Notificar por e-mail</button></div></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card label="Demanda em até 3 dias" value={farol.demand} note="sinalização antecipada" tone={farol.demand ? "emerald" : "slate"} /><Card label="Possível atraso" value={farol.delay} note="vence hoje ou amanhã" tone={farol.delay ? "amber" : "slate"} /><Card label="Ponto de atenção" value={farol.attention} note="1 a 3 dias em atraso" tone={farol.attention ? "amber" : "slate"} /><Card label="Alerta" value={farol.alert} note="mais de 5 dias em atraso" tone={farol.alert ? "rose" : "slate"} /></div>
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-4"><label className="grid gap-1 text-xs font-semibold text-slate-600">Farol<select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => setTaskSignalFilter(event.target.value)} value={taskSignalFilter}>{["Todos", "Demanda próxima", "Possível atraso", "Ponto de atenção", "Alerta", "Programado", "Sem data"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Pedido<select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => setTaskOrderFilter(event.target.value)} value={taskOrderFilter}>{taskOrders.map((item) => <option key={item}>{item}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Núcleo<select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => setTaskNucleusFilter(event.target.value)} value={taskNucleusFilter}>{taskNuclei.map((item) => <option key={item}>{item}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Material<input className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => setTaskMaterialFilter(event.target.value)} placeholder="Digite para filtrar" value={taskMaterialFilter} /></label></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Registrar ação do setor</h3><p className="mt-1 text-xs text-slate-500">Vincule a ação a um pedido específico ou agrupe o acompanhamento por qualquer material conciliado.</p><div className="mt-4 grid gap-3"><label className="grid gap-1 text-xs font-semibold text-slate-600">Vincular por<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setTaskLinkMode(event.target.value as "pedido" | "material")} value={taskLinkMode}><option value="pedido">Pedido pendente</option><option value="material">Material</option></select></label>{taskLinkMode === "pedido" ? <label className="grid gap-1 text-xs font-semibold text-slate-600">Pedido<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setTaskPendingId(event.target.value)} value={taskPendingId}><option value="">Sem pedido vinculado</option>{pendingSignals.map((signal) => <option key={signal.id} value={signal.id}>{signal.reference} · {signal.material} · {signal.nucleus}</option>)}</select></label> : <label className="grid gap-1 text-xs font-semibold text-slate-600">Material<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setTaskMaterialLink(event.target.value)} value={taskMaterialLink}><option value="">Selecione o material</option>{taskMaterialOptions.map((material) => <option key={material}>{material}</option>)}</select></label>}<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" onChange={(event) => setTaskTitle(event.target.value)} placeholder="Título da ação (opcional)" value={taskTitle} /><textarea className="min-h-28 rounded-xl border border-slate-200 px-3 py-2.5 text-sm" onChange={(event) => setTaskNote(event.target.value)} placeholder="Descreva a ação, causa da falta e próximo passo." value={taskNote} /><button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white" onClick={addLinkedTask} type="button">Registrar no histórico</button></div></div>
      <Table empty="Nenhum pedido atende aos filtros selecionados." headers={["Farol", "Previsão", "Pedido", "Material", "Núcleo", "Volume solicitado"]} rows={filteredPendingSignals.map((signal) => [<span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-bold", signalStyle[signal.tone])} key={signal.id}>{signal.status}</span>, signal.dueDate ? new Intl.DateTimeFormat("pt-BR").format(signal.dueDate) : "Sem data", signal.reference, signal.material, signal.nucleus, formatNumber(signal.quantity)])} />
      <div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Histórico de ações</h3><div className="mt-4 space-y-3">{tasks.length ? tasks.slice().reverse().map((item) => { const linked = pendingSignals.find((signal) => signal.id === item.pendingId); const reference = linked ? `${linked.reference} · ${linked.material} · ${linked.nucleus}` : item.material ? `${item.material}${item.nucleus ? ` · ${item.nucleus}` : ""}` : "Ação geral"; return <article className="rounded-xl bg-slate-50 p-4" key={item.id}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-800">{item.title}</p><p className="mt-1 text-xs text-slate-500">{reference} · criado em {formatDateTime(item.createdAt)}</p></div><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" /></div><div className="mt-3 space-y-2 border-l-2 border-emerald-200 pl-3">{item.actions.map((action) => <div key={action.id}><p className="text-sm text-slate-700">{action.note}</p><p className="mt-1 text-[11px] text-slate-500">{formatDateTime(action.createdAt)}</p></div>)}</div><div className="mt-3 flex gap-2"><input className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" onChange={(event) => setTaskActionDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Adicionar atualização" value={taskActionDrafts[item.id] || ""} /><button className="rounded-lg border border-emerald-700 px-3 text-sm font-semibold text-emerald-700" onClick={() => appendTaskAction(item.id)} type="button">Salvar</button></div></article>; }) : <p className="py-10 text-center text-sm text-slate-500">Nenhuma ação registrada ainda.</p>}</div></div>
      </div>
    </section>;
  } else if (active === "Fechamentos") {
    const suppliers = new Map<string, string>();
    for (const closing of commercialClosings.closings) {
      const key = closingSupplierKey(closing.supplier);
      if (!suppliers.has(key)) suppliers.set(key, closing.supplier.trim() || "Fornecedor não informado");
    }
    const supplierOptions = [...suppliers].sort(([, left], [, right]) => left.localeCompare(right, "pt-BR"));
    const supplierFilter = closingSupplierFilter !== null && suppliers.has(closingSupplierFilter) ? closingSupplierFilter : null;
    const filteredSupplierGroups = new Map<string, typeof filteredCommercialClosings>();
    for (const entry of filteredCommercialClosings) {
      const key = closingSupplierKey(entry.closing.supplier);
      if (supplierFilter !== null && key !== supplierFilter) continue;
      const group = filteredSupplierGroups.get(key);
      if (group) group.push(entry);
      else filteredSupplierGroups.set(key, [entry]);
    }
    const showSupplierFilter = closingTab === "calendario" || closingTab === "distribuicoes";
    const filteredOrderKeys = new Set(commercialOverview.closings.map((closing) => closing.orderKey).filter(Boolean));
    const suppliedByLinkedOrders = commercialOrders.filter((order) => filteredOrderKeys.has(order.key)).reduce((sum, order) => sum + order.supplied, 0);
    const physicalVolumes = new Map<string, number>();
    for (const closing of commercialOverview.closings) {
      const unit = closing.unit?.trim().toUpperCase() || "";
      physicalVolumes.set(unit, (physicalVolumes.get(unit) ?? 0) + closing.totalVolume);
    }
    const commercialFinancial = (currency: CommercialClosing["currency"]) => commercialOverview.closings.filter((closing) => closing.currency === currency).reduce((sum, closing) => sum + closing.totalVolume * closing.unitPrice, 0);
    const selectedOrderForDraft = commercialOrders.find((order) => order.key === closingDraft.orderKey);
    const draftDistributed = Object.values(closingDistributionDraft).reduce((sum, amount) => sum + numberFrom(amount), 0);
    content = currentUser?.role === "admin" ? <section className="space-y-6">
      {closingTab !== "calendario" && !datasets.pedidosCompra.length ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>Pedido de compra pendente.</strong> Importe <em>PEDIDOS COMPRA.xlsx</em> na Central de importações para vincular as distribuições e conciliar a quantidade fornecida.</div> : null}
      {closingMessage ? <p className={cn("rounded-xl px-4 py-3 text-sm", /salvo|atualizado|sugerida|vinculada/i.test(closingMessage) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>{closingMessage}</p> : null}
      <div aria-label="Visões de fechamentos" className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" role="group">
        {([
          ["calendario", "Calendário"],
          ["painel", "Visão comercial"],
          ["distribuicoes", "Distribuições"],
          ["anotacoes", "Anotações"],
        ] as const).map(([tab, label]) => (
          <button
            aria-pressed={closingTab === tab}
            className={cn("rounded-xl px-4 py-2 text-sm font-bold", closingTab === tab ? "bg-emerald-700 text-white" : "bg-white text-slate-600 hover:bg-slate-100")}
            key={tab}
            onClick={() => setClosingTab(tab)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className={cn("grid gap-3 rounded-2xl border border-slate-200 bg-white p-4", showSupplierFilter ? "md:grid-cols-[minmax(120px,.5fr)_minmax(180px,1fr)_minmax(220px,1.5fr)]" : "md:grid-cols-[minmax(160px,.5fr)_minmax(260px,1fr)]")}>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Ciclo
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" onChange={(event) => setClosingCycleFilter(event.target.value)} value={closingCycleFilter}>
            <option>Todos</option><option>Safra</option><option>Safrinha</option>
          </select>
        </label>
        {showSupplierFilter ? (
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Fornecedor
            <select
              className="min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
              onChange={(event) => setClosingSupplierFilter(event.target.value === "todos" ? null : event.target.value)}
              value={supplierFilter ?? "todos"}
            >
              <option value="todos">Todos os fornecedores</option>
              {supplierOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Buscar produto, princípio ativo, fornecedor ou pedido
          <input className="min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" onChange={(event) => setClosingQuery(event.target.value)} placeholder="Digite para filtrar" value={closingQuery} />
        </label>
      </div>
      {closingTab === "calendario" ? (
        <CommercialClosingCalendar
          groups={supplierOptions.flatMap(([key, name]) => {
            const closings = filteredSupplierGroups.get(key);
            return closings ? [{
              key, name,
              closings: closings.map(({ closing, active, physicalProduct }) => ({ ...closing, active, product: physicalProduct })),
            }] : [];
          })}
          onPeriodChange={setClosingCalendarPeriod}
          period={closingCalendarPeriod}
          registeredMonths={registeredClosingMonths}
          supplier={supplierFilter === null ? undefined : suppliers.get(supplierFilter)}
        />
      ) : null}
      {closingTab === "painel" ? (
        <section className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card
              label="Volume físico fechado"
              note={`${commercialOverview.closings.length} distribuição(ões)`}
              tone="emerald"
              value={physicalVolumes.size ? [...physicalVolumes].sort(([left], [right]) => left.localeCompare(right)).map(([unit, value]) => (
                <span className="block text-xl" key={unit}>{formatNumber(value)}{unit ? ` ${unit}` : ""}</span>
              )) : "0"}
            />
            <Card label="Quantidade fornecida" value={formatNumber(suppliedByLinkedOrders)} note="pedidos vinculados" tone={suppliedByLinkedOrders ? "emerald" : "slate"} />
            <Card label="Fechado em BRL" value={formatCurrency(commercialFinancial("BRL"), "BRL")} note="volume físico × valor unitário" tone="slate" />
            <Card label="Fechado em USD" value={formatCurrency(commercialFinancial("USD"), "USD")} note="volume físico × valor unitário" tone="slate" />
          </div>
          <CommercialClosingBalances
            empty={normalizedClosingQuery || planningDistribution.size ? "Nenhum produto encontrado para os filtros atuais." : "Importe o Planejamento para calcular o volume restante do ciclo."}
            expandMatches={Boolean(normalizedClosingQuery)}
            groups={commercialOverview.groups}
          />
        </section>
      ) : null}
      {closingTab === "distribuicoes" ? <section className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{editingClosingId ? "Editar distribuição" : "Nova distribuição comercial"}</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">O calendário pode ser sugerido pelo planejamento, usando as datas previstas de aplicação derivadas do DAE.</p></div>{editingClosingId ? <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600" onClick={resetClosingDraft} type="button">Cancelar edição</button> : null}</div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label className="grid gap-1 text-xs font-semibold text-slate-600">Fornecedor<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingDraft((current) => ({ ...current, supplier: event.target.value }))} value={closingDraft.supplier} /></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Vencimento para pagamento<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingDraft((current) => ({ ...current, paymentDue: event.target.value }))} type="date" value={closingDraft.paymentDue} /></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Destino<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingDraft((current) => ({ ...current, destination: event.target.value }))} placeholder="Ex.: 0714 ou núcleo" value={closingDraft.destination} /></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Local de entrega<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingDraft((current) => ({ ...current, deliveryLocation: event.target.value }))} placeholder="Fazenda ou armazém" value={closingDraft.deliveryLocation} /></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Ciclo<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingDraft((current) => ({ ...current, cycle: event.target.value as CommercialClosing["cycle"] }))} value={closingDraft.cycle}><option>Safra</option><option>Safrinha</option></select></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Cultura<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingDraft((current) => ({ ...current, culture: event.target.value }))} placeholder="Ex.: Soja" value={closingDraft.culture} /></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Princípio ativo<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingDraft((current) => ({ ...current, active: event.target.value }))} value={closingDraft.active} /></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Produto<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" list="commercial-materials" onChange={(event) => { const product = event.target.value; const option = commercialMaterialOptions.find((item) => normalizeMaterial(item.product) === normalizeMaterial(product)); setClosingDraft((current) => ({ ...current, product, active: option?.active || current.active })); }} value={closingDraft.product} /><datalist id="commercial-materials">{commercialMaterialOptions.map((item) => <option key={item.product} value={item.product}>{item.active}</option>)}</datalist></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Moeda<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingDraft((current) => ({ ...current, currency: event.target.value as CommercialClosing["currency"] }))} value={closingDraft.currency}><option value="BRL">BRL</option><option value="USD">USD</option></select></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Valor unitário<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" inputMode="decimal" onChange={(event) => setClosingDraft((current) => ({ ...current, unitPrice: event.target.value }))} value={closingDraft.unitPrice} /></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Embalagem<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingDraft((current) => ({ ...current, packaging: event.target.value }))} placeholder="Ex.: galão 20 L" value={closingDraft.packaging} /></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Volume total<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" inputMode="decimal" onChange={(event) => setClosingDraft((current) => ({ ...current, totalVolume: event.target.value }))} value={closingDraft.totalVolume} /></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Unidade<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingDraft((current) => ({ ...current, unit: event.target.value }))} placeholder="L, KG, UN" value={closingDraft.unit} /></label><label className="grid gap-1 text-xs font-semibold text-slate-600 xl:col-span-2">Pedido de compra vinculado<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" disabled={!commercialOrders.length} onChange={(event) => applyClosingOrder(event.target.value)} value={closingDraft.orderKey}><option value="">Vincular depois</option>{commercialOrders.map((order) => <option key={order.key} value={order.key}>{order.orderNumber} · item {order.item} · {order.product} · fornecido {formatNumber(order.supplied)} {order.unit}</option>)}</select></label></div>{selectedOrderForDraft ? <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">Pedido {selectedOrderForDraft.orderNumber}: {formatNumber(selectedOrderForDraft.ordered)} pedido, {formatNumber(selectedOrderForDraft.supplied)} fornecido e {formatNumber(selectedOrderForDraft.balance)} a fornecer.</p> : null}<div className="mt-5 border-t border-slate-100 pt-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h4 className="font-semibold">Distribuição mensal</h4><p className="mt-1 text-xs text-slate-500">Preencha os volumes por mês. Total distribuído: <strong>{formatNumber(draftDistributed)}</strong> de {formatNumber(numberFrom(closingDraft.totalVolume))}.</p></div><button className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-700" onClick={applyPlanningDistribution} type="button">Sugerir pelo planejamento</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">{closingMonths.map((month) => <label className="grid gap-1 text-xs font-semibold text-slate-600" key={month}>{formatMonth(month)}<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" inputMode="decimal" onChange={(event) => setClosingDistributionDraft((current) => ({ ...current, [month]: numberFrom(event.target.value) }))} value={closingDistributionDraft[month] || ""} /></label>)}{!closingMonths.length ? <p className="text-sm text-amber-800">Ainda não há meses previstos no Planejamento para criar a distribuição.</p> : null}</div></div><div className="mt-5 flex justify-end"><button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white" onClick={saveCommercialClosing} type="button">{editingClosingId ? "Salvar alterações" : "Salvar fechamento"}</button></div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-semibold">Distribuições registradas</h3>
          {filteredSupplierGroups.size ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[1060px] text-left text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {["Ativo / produto", "Ciclo", "Preço", "Pagamento", "Entrega", "Programado", "Pedido", "Fornecido", "Ações"].map((head) => (
                      <th className="px-3 py-2.5 font-semibold" key={head} scope="col">{head}</th>
                    ))}
                  </tr>
                </thead>
                {supplierOptions.map(([key, name]) => {
                  const closings = filteredSupplierGroups.get(key);
                  if (!closings) return null;
                  return (
                    <tbody className="divide-y divide-slate-100" key={key}>
                      <tr className="border-t border-slate-200 bg-emerald-50">
                        <th className="px-3 py-3" colSpan={9} scope="rowgroup">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <span className="font-bold text-emerald-950">{name}</span>
                            <span className="text-xs font-medium text-slate-500">{closings.length} {closings.length === 1 ? "distribuição" : "distribuições"}</span>
                            <button
                              aria-label={`Ver calendário de ${name}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:border-emerald-600"
                              onClick={() => {
                                setClosingSupplierFilter(key);
                                setClosingTab("calendario");
                                window.scrollTo({ top: 0 });
                              }}
                              type="button"
                            >
                              <CalendarDays aria-hidden="true" className="size-4" />
                              Ver calendário
                            </button>
                          </div>
                        </th>
                      </tr>
                      {closings.map(({ closing }) => {
                        const order = commercialOrders.find((item) => item.key === closing.orderKey);
                        return (
                          <tr key={closing.id}>
                            <td className="px-3 py-3"><strong>{closing.active}</strong><br /><span className="text-xs text-slate-500">{closing.product}</span></td>
                            <td className="px-3 py-3">{closing.cycle}<br /><span className="text-xs text-slate-500">{closing.culture || "—"}</span></td>
                            <td className="px-3 py-3">{formatCurrency(closing.unitPrice, closing.currency)}<br /><span className="text-xs text-slate-500">{closing.packaging || closing.unit}</span></td>
                            <td className="px-3 py-3">{closing.paymentDue ? new Intl.DateTimeFormat("pt-BR").format(new Date(closing.paymentDue + "T00:00:00")) : "—"}</td>
                            <td className="px-3 py-3">{closing.destination || "—"}<br /><span className="text-xs text-slate-500">{closing.deliveryLocation || "—"}</span></td>
                            <td className="px-3 py-3 font-semibold text-emerald-700">{formatNumber(closing.totalVolume)} {closing.unit}<br /><span className="text-xs font-normal text-slate-500">{Object.keys(closing.distribution).length} mês(es)</span></td>
                            <td className="px-3 py-3">{closing.orderNumber || "Não vinculado"}</td>
                            <td className="px-3 py-3">{order ? `${formatNumber(order.supplied)} ${order.unit}` : "—"}</td>
                            <td className="px-3 py-3">
                              <div className="flex gap-2">
                                <button className="text-xs font-bold text-emerald-700" onClick={() => editCommercialClosing(closing)} type="button">Editar</button>
                                <button className="text-xs font-bold text-rose-700" onClick={() => removeCommercialClosing(closing)} type="button">Excluir</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  );
                })}
              </table>
            </div>
          ) : <p className="py-10 text-center text-sm text-slate-500">Nenhuma distribuição encontrada para os filtros atuais.</p>}
        </section>
      </section> : null}
      {closingTab === "anotacoes" ? <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Nova anotação</h3><p className="mt-1 text-xs text-slate-500">Registre condição de faturamento, volume enviado e observações do fornecedor.</p><div className="mt-4 grid gap-3"><label className="grid gap-1 text-xs font-semibold text-slate-600">Fechamento<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingAnnotationDraft((current) => ({ ...current, closingId: event.target.value }))} value={closingAnnotationDraft.closingId}><option value="">Selecione a distribuição</option>{commercialClosings.closings.map((closing) => <option key={closing.id} value={closing.id}>{closing.supplier} · {closing.product} · {formatNumber(closing.totalVolume)} {closing.unit}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Material enviado<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingAnnotationDraft((current) => ({ ...current, materialSent: event.target.value }))} value={closingAnnotationDraft.materialSent} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-semibold text-slate-600">Compra<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" inputMode="decimal" onChange={(event) => setClosingAnnotationDraft((current) => ({ ...current, purchaseVolume: event.target.value }))} value={closingAnnotationDraft.purchaseVolume} /></label><label className="grid gap-1 text-xs font-semibold text-slate-600">Faturamento<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" inputMode="decimal" onChange={(event) => setClosingAnnotationDraft((current) => ({ ...current, invoicedVolume: event.target.value }))} value={closingAnnotationDraft.invoicedVolume} /></label></div><label className="grid gap-1 text-xs font-semibold text-slate-600">Observação<textarea className="min-h-28 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setClosingAnnotationDraft((current) => ({ ...current, note: event.target.value }))} value={closingAnnotationDraft.note} /></label><label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input checked={closingAnnotationDraft.resolved} onChange={(event) => setClosingAnnotationDraft((current) => ({ ...current, resolved: event.target.checked }))} type="checkbox" />Resolvida</label><button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white" onClick={saveClosingAnnotation} type="button">Salvar anotação</button></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><div><h3 className="font-semibold">Anotações de faturamento</h3><p className="mt-1 text-xs text-slate-500">Histórico vinculado ao fechamento para concentrar tratativas comerciais.</p></div><div className="mt-4 space-y-3">{commercialClosings.annotations.map((annotation) => { const closing = commercialClosings.closings.find((item) => item.id === annotation.closingId); return <article className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={annotation.id}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-800">{closing ? `${closing.supplier} · ${closing.product}` : "Fechamento removido"}</p><p className="mt-1 text-xs text-slate-500">{annotation.materialSent || "Material não informado"} · criado em {formatDateTime(annotation.createdAt)}</p></div><div className="flex items-center gap-3"><span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", annotation.resolved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900")}>{annotation.resolved ? "Resolvida" : "Em aberto"}</span><button className="text-xs font-bold text-rose-700" onClick={() => removeClosingAnnotation(annotation)} type="button">Excluir</button></div></div><p className="mt-3 text-sm text-slate-700">{annotation.note}</p><p className="mt-3 text-xs font-semibold text-slate-600">Compra: {annotation.purchaseVolume === null ? "—" : formatNumber(annotation.purchaseVolume)} · Faturamento: {annotation.invoicedVolume === null ? "—" : formatNumber(annotation.invoicedVolume)}</p></article>; })}{!commercialClosings.annotations.length ? <p className="py-10 text-center text-sm text-slate-500">Nenhuma anotação cadastrada.</p> : null}</div></section></section> : null}
    </section> : <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><h2 className="font-semibold text-amber-950">Acesso restrito</h2><p className="mt-2 text-sm text-amber-900">Fechamentos comerciais, distribuições e anotações são funções exclusivas de administradores.</p></section>;
  } else if (active === "Logística") {
    const recipeTrip = logistics.trips.find((trip) => trip.id === recipeTripId) || null;
    const selectedDriver = logistics.drivers.find((driver) => driver.id === tripDriverId);
    const selectedVehicle = logistics.vehicles.find((vehicle) => vehicle.id === tripVehicleId);
    content = currentUser?.role === "admin" ? <section className="space-y-6">
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <p className="text-xs font-bold uppercase tracking-[.12em] text-emerald-700">Logística de carregamento</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold text-emerald-950">Emissão e organização de viagens</h2><p className="mt-1 max-w-3xl text-sm leading-relaxed text-emerald-900">Monte a rota por solicitação, material, motorista, veículo e nota fiscal. Depois vincule a receita ao carregamento emitido.</p></div><span className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-emerald-800">Acesso administrativo</span></div>
      </section>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3"><button className={cn("rounded-xl px-4 py-2 text-sm font-bold", logisticsTab === "emissao" ? "bg-emerald-700 text-white" : "bg-white text-slate-600 hover:bg-slate-100")} onClick={() => setLogisticsTab("emissao")} type="button">Emissão de viagem</button><button className={cn("rounded-xl px-4 py-2 text-sm font-bold", logisticsTab === "viagens" ? "bg-emerald-700 text-white" : "bg-white text-slate-600 hover:bg-slate-100")} onClick={() => setLogisticsTab("viagens")} type="button">Viagens emitidas</button><button className={cn("rounded-xl px-4 py-2 text-sm font-bold", logisticsTab === "rodoviaria" ? "bg-emerald-700 text-white" : "bg-white text-slate-600 hover:bg-slate-100")} onClick={() => setLogisticsTab("rodoviaria")} type="button">Configuração rodoviária</button></div>

      {!datasets.solicitacoesWeb.length || !datasets.estoqueWeb.length ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>Fontes pendentes.</strong> Importe <em>Relação de solicitação webAgil</em> e <em>Estoque webAgil</em> na Central de importações para habilitar a emissão com saldo e lote.</div> : null}
      {logisticsMessage ? <p className={cn("rounded-xl px-4 py-3 text-sm", /cadastrado|emitida|vinculada|adicionado/i.test(logisticsMessage) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>{logisticsMessage}</p> : null}

      {logisticsTab === "emissao" ? <section className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3"><Card label="Solicitações disponíveis" value={logisticsRequests.length} note="aceitas e não canceladas" /><Card label="Saldo do material" value={selectedLogisticsLine ? formatNumber(selectedLogisticsStock.balance) : "—"} note={selectedLogisticsLine ? `${selectedLogisticsStock.pallets} palete(s) no estoque web` : "selecione uma solicitação"} tone={selectedLogisticsLine && selectedLogisticsStock.balance < selectedLogisticsLine.quantity ? "amber" : "emerald"} /><Card label="Viagens emitidas" value={logistics.trips.length} note="salvas na base central" /></div>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div><h3 className="font-semibold">Dados da rota e emissão</h3><p className="mt-1 text-xs text-slate-500">Inclua materiais de uma ou mais solicitações na mesma rota. O saldo considera produto e lote do Estoque webAgil.</p></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">Solicitação<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" disabled={!logisticsRequests.length} onChange={(event) => { setTripRequestId(event.target.value); setTripMaterialKey(""); }} value={tripRequestId}><option value="">Selecione a solicitação</option>{logisticsRequests.map((request) => <option key={request.id} value={request.id}>{request.id} · {request.destination || "Destino não informado"} · {request.lines.length} material(is)</option>)}</select></label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">Material e lote<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" disabled={!selectedLogisticsRequest} onChange={(event) => setTripMaterialKey(event.target.value)} value={tripMaterialKey}><option value="">Selecione o material</option>{selectedLogisticsRequest?.lines.map((line) => <option key={line.id} value={line.id}>{line.product} · lote {line.lot || "não informado"} · {formatNumber(line.quantity)} {line.unit}</option>)}</select></label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Origem</p><p className="mt-1 font-semibold text-slate-800">{selectedLogisticsStock.warehouses.join(", ") || selectedLogisticsRequest?.sourceWarehouse || "—"}</p><p className="mt-1 text-xs text-slate-500">Saldo localizado: {selectedLogisticsLine ? formatNumber(selectedLogisticsStock.balance) : "—"}</p></div>
            <div className="flex items-end"><button className="w-full rounded-xl border border-emerald-700 px-4 py-2.5 text-sm font-bold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={!selectedRouteItem} onClick={addRouteItem} type="button">Adicionar material à rota</button></div>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">Motorista<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setTripDriverId(event.target.value)} value={tripDriverId}><option value="">Selecione o motorista</option>{logistics.drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName} · CPF {driver.cpf}</option>)}</select></label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">Veículo<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setTripVehicleId(event.target.value)} value={tripVehicleId}><option value="">Selecione a placa</option>{logistics.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.model} · {formatNumber(vehicle.capacity)} kg</option>)}</select></label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700 lg:col-span-2">Nota fiscal vinculada<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setTripInvoiceNumber(event.target.value)} placeholder="Digite a nota fiscal da viagem" value={tripInvoiceNumber} /></label>
          </div>
          <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-bold text-emerald-950">Carga da rota</h4><p className="mt-1 text-xs text-emerald-900">{routeItems.length} material(is) · {new Set(routeItems.map((item) => item.requestId)).size} solicitação(ões)</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-800">Uma viagem, várias solicitações</span></div>{routeItems.length ? <div className="mt-3 divide-y divide-emerald-100 rounded-lg bg-white">{routeItems.map((item) => <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm" key={item.id}><div><p className="font-semibold text-slate-800">{item.product} <span className="font-normal text-slate-500">· lote {item.lot || "não informado"}</span></p><p className="mt-0.5 text-xs text-slate-500">Solicitação {item.requestId} · {formatNumber(item.quantity)} {item.unit} · {item.sourceWarehouse} → {item.destination}</p></div><button className="text-xs font-bold text-rose-700" onClick={() => removeRouteItem(item.id)} type="button">Remover</button></div>)}</div> : <p className="mt-3 text-sm text-slate-600">Selecione uma solicitação e um material, depois use “Adicionar material à rota”. Você pode trocar a solicitação e repetir o processo.</p>}</div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="text-xs text-slate-500">{selectedDriver && selectedVehicle ? `Rota pronta: ${selectedDriver.fullName} · ${selectedVehicle.plate}` : "Cadastre e selecione motorista e veículo para completar a rota."}</p><button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" disabled={!routeItems.length || !tripDriverId || !tripVehicleId || !tripInvoiceNumber.trim()} onClick={createLogisticsTrip} type="button">Emitir viagem</button></div>
        </section>
        {recipeTrip ? <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5"><div><h3 className="font-semibold text-sky-950">Vincular receita à viagem</h3><p className="mt-1 text-xs text-sky-900">{logisticsTripItems(recipeTrip).length} material(is) · {new Set(logisticsTripItems(recipeTrip).map((item) => item.requestId)).size} solicitação(ões) · NF {recipeTrip.invoiceNumber}</p></div><div className="mt-4 grid gap-3 md:grid-cols-3"><label className="grid gap-1 text-sm font-semibold text-slate-700">Cultura<input className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal" onChange={(event) => setRecipeDraft((current) => ({ ...current, culture: event.target.value }))} placeholder="Ex.: Soja" value={recipeDraft.culture} /></label><label className="grid gap-1 text-sm font-semibold text-slate-700">Alvo<input className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal" onChange={(event) => setRecipeDraft((current) => ({ ...current, target: event.target.value }))} placeholder="Ex.: Mancha-alvo" value={recipeDraft.target} /></label><label className="grid gap-1 text-sm font-semibold text-slate-700">Dose<input className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal" onChange={(event) => setRecipeDraft((current) => ({ ...current, dose: event.target.value }))} placeholder="Ex.: 0,50 L/ha" value={recipeDraft.dose} /></label></div><div className="mt-4 flex justify-end"><button className="rounded-xl border border-sky-700 bg-white px-4 py-2.5 text-sm font-bold text-sky-800" onClick={attachTripRecipe} type="button">Vincular receita</button></div></section> : null}
      </section> : null}

      {logisticsTab === "viagens" ? <section className="space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">Viagens emitidas</h3><p className="mt-1 text-xs text-slate-500">Cada documento exportado lista todos os materiais e solicitações vinculados à rota.</p></div><span className="text-sm font-bold text-emerald-800">{logistics.trips.length} registro(s)</span></div><Table empty="Nenhuma viagem emitida." headers={["Solicitações", "Carga da rota", "Rota", "Motorista / placa", "NF", "Receita", "Ações"]} rows={logistics.trips.map((trip) => { const driver = logistics.drivers.find((item) => item.id === trip.driverId); const vehicle = logistics.vehicles.find((item) => item.id === trip.vehicleId); const items = logisticsTripItems(trip); const requests = [...new Set(items.map((item) => item.requestId))]; return [<span key={`${trip.id}-requests`} className="font-semibold">{requests.join(", ")}<br /><small className="font-normal text-slate-500">{requests.length} solicitação(ões)</small></span>, <span key={`${trip.id}-material`}>{items.slice(0, 2).map((item) => <span className="block" key={item.id}>{item.product} <small className="text-slate-500">· {formatNumber(item.quantity)} {item.unit}</small></span>)}{items.length > 2 ? <small className="text-slate-500">+ {items.length - 2} material(is)</small> : null}</span>, <span key={`${trip.id}-route`}>{trip.sourceWarehouse}<br /><small className="text-slate-500">→ {trip.destination}</small></span>, <span key={`${trip.id}-driver`}>{driver?.fullName || "Cadastro removido"}<br /><small className="text-slate-500">{vehicle?.plate || "Placa removida"}</small></span>, trip.invoiceNumber, trip.recipe ? <span className="font-semibold text-emerald-700">{trip.recipe.culture} · {trip.recipe.target}<br /><small>{trip.recipe.dose}</small></span> : <button className="text-xs font-bold text-sky-700" key={`${trip.id}-recipe`} onClick={() => { setRecipeTripId(trip.id); setLogisticsTab("emissao"); }} type="button">Vincular receita</button>, <span className="flex flex-wrap gap-2" key={`${trip.id}-actions`}><button className="rounded-lg border border-emerald-700 px-2.5 py-1.5 text-xs font-bold text-emerald-700" onClick={() => void exportLogisticsDocument(trip)} type="button">Exportar doc.</button><button className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-700" onClick={() => removeLogisticsTrip(trip)} type="button">Excluir</button></span>]; })} /></section> : null}

      {logisticsTab === "rodoviaria" ? <section className="grid gap-5 xl:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Motoristas</h3><p className="mt-1 text-xs text-slate-500">Cadastre nome completo e CPF para vincular às viagens.</p><div className="mt-4 grid gap-3"><label className="grid gap-1 text-sm font-semibold text-slate-700">Nome completo<input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" onChange={(event) => setDriverDraft((current) => ({ ...current, fullName: event.target.value }))} value={driverDraft.fullName} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold text-slate-700">CPF<input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" inputMode="numeric" onChange={(event) => setDriverDraft((current) => ({ ...current, cpf: event.target.value }))} placeholder="Somente números" value={driverDraft.cpf} /></label><label className="grid gap-1 text-sm font-semibold text-slate-700">Telefone (opcional)<input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" onChange={(event) => setDriverDraft((current) => ({ ...current, phone: event.target.value }))} value={driverDraft.phone} /></label></div><button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white" onClick={addRoadDriver} type="button">Cadastrar motorista</button></div><div className="mt-5 border-t border-slate-100 pt-4"><Table empty="Nenhum motorista cadastrado." headers={["Motorista", "CPF", "Telefone", "Ação"]} rows={logistics.drivers.map((driver) => [driver.fullName, driver.cpf, driver.phone || "—", <button className="text-xs font-bold text-rose-700" key={driver.id} onClick={() => removeRoadDriver(driver)} type="button">Excluir</button>])} /></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Veículos</h3><p className="mt-1 text-xs text-slate-500">A capacidade é armazenada em kg para apoiar a separação de carga.</p><div className="mt-4 grid gap-3"><label className="grid gap-1 text-sm font-semibold text-slate-700">Placa<input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal uppercase" onChange={(event) => setVehicleDraft((current) => ({ ...current, plate: event.target.value }))} placeholder="ABC1D23" value={vehicleDraft.plate} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold text-slate-700">Modelo<input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" onChange={(event) => setVehicleDraft((current) => ({ ...current, model: event.target.value }))} placeholder="Ex.: Bitruck" value={vehicleDraft.model} /></label><label className="grid gap-1 text-sm font-semibold text-slate-700">Capacidade (kg)<input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" inputMode="decimal" onChange={(event) => setVehicleDraft((current) => ({ ...current, capacity: event.target.value }))} placeholder="Ex.: 15000" value={vehicleDraft.capacity} /></label></div><button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white" onClick={addRoadVehicle} type="button">Cadastrar veículo</button></div><div className="mt-5 border-t border-slate-100 pt-4"><Table empty="Nenhum veículo cadastrado." headers={["Placa", "Modelo", "Capacidade", "Ação"]} rows={logistics.vehicles.map((vehicle) => [vehicle.plate, vehicle.model, `${formatNumber(vehicle.capacity)} kg`, <button className="text-xs font-bold text-rose-700" key={vehicle.id} onClick={() => removeRoadVehicle(vehicle)} type="button">Excluir</button>])} /></div></section></section> : null}
    </section> : <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><h2 className="font-semibold text-amber-950">Acesso restrito</h2><p className="mt-2 text-sm text-amber-900">A logística de carregamento pode ser consultada e administrada somente por usuários administradores.</p></section>;
  } else if (active === "Usuários") {
    content = currentUser?.role === "admin" ? <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Administração de acesso</p><h2 className="mt-1 text-xl font-bold text-emerald-950">Usuários da plataforma</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-emerald-900">Crie e mantenha as contas que acessam a base central. Apenas administradores podem gerenciar usuários.</p></div><div className="rounded-xl bg-white px-4 py-3 text-right shadow-sm"><p className="text-xs font-semibold text-slate-500">Sua sessão</p><p className="mt-1 text-sm font-bold text-slate-800">{currentUser.name}</p><p className="text-xs text-emerald-700">Administrador</p></div></div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.8fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h3 className="font-semibold">Contas cadastradas</h3><p className="mt-1 text-xs text-slate-500">{managedUsers.length} usuário(s) com acesso ao AgroNexus.</p></div><button className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-50" disabled={userManagerLoading} onClick={() => void loadManagedUsers()} type="button">Atualizar</button></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Usuário</th><th className="px-4 py-3 font-semibold">Login</th><th className="px-4 py-3 font-semibold">Perfil</th><th className="px-4 py-3 font-semibold">Criado em</th><th className="px-5 py-3 text-right font-semibold">Ações</th></tr></thead><tbody className="divide-y divide-slate-100">{managedUsers.map((user) => <tr key={user.id}><td className="px-5 py-4 font-semibold text-slate-800">{user.name}{user.id === currentUser.id ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">VOCÊ</span> : null}</td><td className="px-4 py-4 text-slate-600">{user.username}</td><td className="px-4 py-4"><span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", user.role === "admin" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700")}>{user.role === "admin" ? "Administrador" : "Operador"}</span></td><td className="px-4 py-4 text-xs text-slate-500">{formatDateTime(user.createdAt)}</td><td className="px-5 py-4 text-right"><div className="inline-flex gap-2"><button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700" onClick={() => editManagedUser(user)} type="button">Editar</button><button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-40" disabled={user.id === currentUser.id || userManagerLoading} onClick={() => void removeManagedUser(user)} type="button">Excluir</button></div></td></tr>)}{!managedUsers.length && !userManagerLoading ? <tr><td className="px-5 py-12 text-center text-sm text-slate-500" colSpan={5}>Nenhum usuário encontrado.</td></tr> : null}</tbody></table></div></section>
        <form className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={saveManagedUser}><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{userDraft.id ? "Editar usuário" : "Nova conta"}</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">{userDraft.id ? "Deixe a senha em branco para mantê-la." : "Defina uma senha inicial para liberar o acesso."}</p></div>{userDraft.id ? <button className="text-xs font-bold text-slate-500" onClick={() => setUserDraft(emptyUserDraft)} type="button">Cancelar</button> : null}</div><div className="mt-5 grid gap-3"><label className="grid gap-1.5 text-xs font-bold text-slate-600">Nome<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setUserDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Nome completo" required value={userDraft.name} /></label><label className="grid gap-1.5 text-xs font-bold text-slate-600">Login<input autoCapitalize="none" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setUserDraft((current) => ({ ...current, username: event.target.value }))} placeholder="nome.sobrenome" required value={userDraft.username} /></label><label className="grid gap-1.5 text-xs font-bold text-slate-600">Perfil<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setUserDraft((current) => ({ ...current, role: event.target.value as UserDraft["role"] }))} value={userDraft.role}><option value="viewer">Operador</option><option value="admin">Administrador</option></select></label><label className="grid gap-1.5 text-xs font-bold text-slate-600">{userDraft.id ? "Nova senha (opcional)" : "Senha inicial"}<input autoComplete="new-password" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" minLength={6} onChange={(event) => setUserDraft((current) => ({ ...current, password: event.target.value }))} placeholder={userDraft.id ? "Manter senha atual" : "Mínimo de 6 caracteres"} required={!userDraft.id} type="password" value={userDraft.password} /></label></div>{userManagerMessage ? <p className={cn("mt-4 rounded-xl px-3 py-2 text-sm", /atualizado|criado|excluído/i.test(userManagerMessage) ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800")}>{userManagerMessage}</p> : null}<button className="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60" disabled={userManagerLoading} type="submit">{userManagerLoading ? "Salvando..." : userDraft.id ? "Salvar alterações" : "Criar usuário"}</button></form>
      </div>
    </section> : <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><h2 className="font-semibold text-amber-950">Acesso restrito</h2><p className="mt-2 text-sm text-amber-900">A administração de usuários está disponível apenas para o perfil administrador.</p></section>;
  } else {
    content = <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-6 py-5"><h2 className="font-semibold">Configurações</h2><p className="mt-2 text-sm text-slate-500">Padronize premissas e destinatários das notificações por núcleo.</p></div><div className="flex gap-2 border-b border-slate-100 px-6 pt-4"><button className={cn("rounded-t-xl px-4 py-2 text-sm font-semibold", settingsTab === "premissas" ? "bg-emerald-50 text-emerald-800" : "text-slate-500")} onClick={() => setSettingsTab("premissas")} type="button">Premissas</button><button className={cn("rounded-t-xl px-4 py-2 text-sm font-semibold", settingsTab === "email" ? "bg-emerald-50 text-emerald-800" : "text-slate-500")} onClick={() => setSettingsTab("email")} type="button">E-mails por núcleo</button></div>{settingsTab === "premissas" ? <div className="p-6"><p className="text-sm text-slate-500">Ajuste dimensões, conversões e regras aplicadas às análises.</p><button className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white" onClick={() => setShowPremises(true)} type="button"><SlidersHorizontal className="h-4 w-4" />Editar premissas</button></div> : <div className="space-y-5 p-6"><div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><p className="font-semibold">Envio por domínio corporativo</p><p className="mt-1 text-xs">Os destinatários abaixo são sugeridos no envio manual de alertas. Use endereços internos @agroboaesperanca.com.br, separados por vírgula.</p></div><label className="grid max-w-xl gap-1.5 text-sm font-medium">Cópia padrão (CC)<input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" onChange={(event) => setEmailSettings((current) => ({ ...current, defaultCopy: event.target.value }))} placeholder="planejamento@agroboaesperanca.com.br" value={emailSettings.defaultCopy} /></label><div><h3 className="text-sm font-semibold">Destinatário padrão por núcleo</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{taskNuclei.filter((nucleus) => nucleus !== "Todos").map((nucleus) => <label className="grid gap-1.5 text-sm font-medium" key={nucleus}>{nucleus}<input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" onChange={(event) => setEmailSettings((current) => ({ ...current, nucleusRecipients: { ...current.nucleusRecipients, [nucleus]: event.target.value } }))} placeholder={`responsavel.${nucleus.toLowerCase()}@agroboaesperanca.com.br`} value={emailSettings.nucleusRecipients[nucleus] || ""} /></label>)}</div>{taskNuclei.length === 1 ? <p className="mt-3 text-sm text-slate-500">Os núcleos aparecem após a importação de pedidos pendentes.</p> : null}</div></div>}</section>;
  }

  if (active === "Tarefas") {
    const taskSignalStyle = { emerald: "bg-emerald-100 text-emerald-800", sky: "bg-sky-100 text-sky-800", amber: "bg-amber-100 text-amber-900", rose: "bg-rose-100 text-rose-800", slate: "bg-slate-100 text-slate-700" };
    content = <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold">Farol e tarefas operacionais</h2><p className="mt-1 text-sm text-slate-500">Registre responsáveis, decisões e próximos passos ligados a pedidos ou materiais.</p></div>
        <div className="flex flex-wrap gap-2"><button className="inline-flex items-center gap-2 rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700" onClick={() => void exportTasks()} type="button"><Download className="h-4 w-4" />Exportar Excel</button><button className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white" onClick={openNotification} type="button"><Bell className="h-4 w-4" />Notificar por e-mail</button></div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">Histórico de ações</h3><p className="mt-1 text-xs text-slate-500">As atualizações mais recentes aparecem primeiro.</p></div><label className="grid gap-1 text-xs font-semibold text-slate-600">Exibir<select className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal" onChange={(event) => { setTaskHistorySize(Number(event.target.value)); setTaskHistoryPage(0); }} value={taskHistorySize}><option value={10}>10 registros</option><option value={30}>30 registros</option><option value={50}>50 registros</option></select></label></div>
        <div className="mt-4 space-y-2">{paginatedTaskHistory.length ? paginatedTaskHistory.map(({ task, ...action }) => <article className="rounded-xl border border-slate-100 bg-slate-50 p-3" key={action.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">{task.title}</p><p className="mt-1 text-sm text-slate-700">{action.note}</p><p className="mt-2 text-xs text-slate-500">{task.material || "Ação geral"}{task.nucleus ? ` · ${task.nucleus}` : ""} · {task.owner || "Não atribuído"}</p></div><p className="text-xs text-slate-500">{formatDateTime(action.createdAt)}</p></div></article>) : <p className="py-6 text-center text-sm text-slate-500">Nenhuma ação registrada ainda.</p>}</div>
        {taskHistory.length > taskHistorySize ? <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-600"><span>Página {safeTaskHistoryPage + 1} de {taskHistoryPages} · {taskHistory.length} ações</span><span className="flex gap-2"><button className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40" disabled={safeTaskHistoryPage === 0} onClick={() => setTaskHistoryPage((current) => Math.max(0, current - 1))} type="button">Anterior</button><button className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40" disabled={safeTaskHistoryPage >= taskHistoryPages - 1} onClick={() => setTaskHistoryPage((current) => Math.min(taskHistoryPages - 1, current + 1))} type="button">Próxima</button></span></div> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Registrar ação do setor</h3><p className="mt-1 text-xs text-slate-500">Vincule a ação a um pedido específico ou agrupe o acompanhamento por material.</p><div className="mt-4 grid gap-3"><label className="grid gap-1 text-xs font-semibold text-slate-600">Vincular por<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setTaskLinkMode(event.target.value as "pedido" | "material")} value={taskLinkMode}><option value="pedido">Pedido pendente</option><option value="material">Material</option></select></label>{taskLinkMode === "pedido" ? <label className="grid gap-1 text-xs font-semibold text-slate-600">Pedido<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setTaskPendingId(event.target.value)} value={taskPendingId}><option value="">Sem pedido vinculado</option>{pendingSignals.map((signal) => <option key={signal.id} value={signal.id}>{signal.reference} · {signal.material} · {signal.nucleus}</option>)}</select></label> : <label className="grid gap-1 text-xs font-semibold text-slate-600">Material<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setTaskMaterialLink(event.target.value)} value={taskMaterialLink}><option value="">Selecione o material</option>{taskMaterialOptions.map((material) => <option key={material}>{material}</option>)}</select></label>}<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" onChange={(event) => setTaskTitle(event.target.value)} placeholder="Título da ação (opcional)" value={taskTitle} /><textarea className="min-h-28 rounded-xl border border-slate-200 px-3 py-2.5 text-sm" onChange={(event) => setTaskNote(event.target.value)} placeholder="Descreva a ação, causa da falta e próximo passo." value={taskNote} /><button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white" onClick={addLinkedTask} type="button">Registrar no histórico</button></div></section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">Responsáveis e prazos</h3><p className="mt-1 text-xs text-slate-500">Acompanhe a execução de cada tarefa aberta.</p></div><div className="grid grid-cols-3 gap-2 text-center text-xs"><span className="rounded-lg bg-sky-50 px-3 py-2 font-bold text-sky-800">{tasks.filter((task) => task.status === "Aberta").length} abertas</span><span className="rounded-lg bg-amber-50 px-3 py-2 font-bold text-amber-800">{tasks.filter((task) => task.status === "Em andamento").length} em curso</span><span className="rounded-lg bg-emerald-50 px-3 py-2 font-bold text-emerald-800">{tasks.filter((task) => task.status === "Concluída").length} concluídas</span></div></div><div className="space-y-3">{tasks.length ? tasks.slice().reverse().map((task) => <article className="rounded-xl border border-slate-200 p-4" key={task.id}><div className="grid gap-3 lg:grid-cols-[minmax(200px,1.4fr)_minmax(130px,.7fr)_150px_160px]"><div><p className="font-semibold text-slate-800">{task.title}</p><p className="mt-1 text-xs text-slate-500">{task.material || "Sem material"}{task.nucleus ? ` · ${task.nucleus}` : ""}</p></div><label className="grid gap-1 text-[11px] font-semibold text-slate-500">Responsável<input className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-800" onBlur={(event) => updateTask(task.id, { owner: event.target.value })} defaultValue={task.owner || ""} /></label><label className="grid gap-1 text-[11px] font-semibold text-slate-500">Prazo<input className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-800" onChange={(event) => updateTask(task.id, { dueDate: event.target.value })} type="date" value={task.dueDate || ""} /></label><label className="grid gap-1 text-[11px] font-semibold text-slate-500">Status<select className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-800" onChange={(event) => updateTask(task.id, { status: event.target.value as TaskStatus })} value={task.status || "Aberta"}>{["Aberta", "Em andamento", "Aguardando", "Concluída"].map((status) => <option key={status}>{status}</option>)}</select></label></div><div className="mt-3 flex flex-wrap gap-2"><input className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" onChange={(event) => setTaskActionDrafts((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="Adicionar atualização ao histórico" value={taskActionDrafts[task.id] || ""} /><button className="rounded-lg border border-emerald-700 px-3 text-sm font-semibold text-emerald-700" onClick={() => appendTaskAction(task.id)} type="button">Salvar atualização</button></div></article>) : <p className="py-6 text-center text-sm text-slate-500">Registre uma ação para iniciar o acompanhamento.</p>}</div></section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">Farol de pedidos pendentes</h3><p className="mt-1 text-xs text-slate-500">Filtre a demanda que orienta as ações da equipe.</p></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><select aria-label="Filtrar farol" className="rounded-lg border border-slate-200 px-2 py-2 text-sm" onChange={(event) => setTaskSignalFilter(event.target.value)} value={taskSignalFilter}>{["Todos", "Demanda próxima", "Possível atraso", "Ponto de atenção", "Alerta", "Programado", "Sem data"].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Filtrar pedido" className="rounded-lg border border-slate-200 px-2 py-2 text-sm" onChange={(event) => setTaskOrderFilter(event.target.value)} value={taskOrderFilter}>{taskOrders.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Filtrar núcleo" className="rounded-lg border border-slate-200 px-2 py-2 text-sm" onChange={(event) => setTaskNucleusFilter(event.target.value)} value={taskNucleusFilter}>{taskNuclei.map((item) => <option key={item}>{item}</option>)}</select><input aria-label="Filtrar material" className="rounded-lg border border-slate-200 px-2 py-2 text-sm" onChange={(event) => setTaskMaterialFilter(event.target.value)} placeholder="Material" value={taskMaterialFilter} /></div></div><Table empty="Nenhum pedido atende aos filtros selecionados." headers={["Farol", "Previsão", "Pedido", "Material", "Núcleo", "Volume solicitado"]} rows={filteredPendingSignals.map((signal) => [<span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-bold", taskSignalStyle[signal.tone])} key={signal.id}>{signal.status}</span>, signal.dueDate ? new Intl.DateTimeFormat("pt-BR").format(signal.dueDate) : "Sem data", signal.reference, signal.material, signal.nucleus, formatNumber(signal.quantity)])} /></section>
    </section>;
  }

  if (active === "Tarefas" && currentUser?.role === "admin") {
    const taskContentForAdmin = content;
    content = <section className="space-y-6">{taskContentForAdmin}<section className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5"><h3 className="font-semibold text-rose-950">Administração de tarefas</h3><p className="mt-1 text-xs text-rose-800">A exclusão remove a tarefa e todas as ações vinculadas. Esta operação não pode ser desfeita.</p><div className="mt-4"><Table empty="Nenhuma tarefa para administrar." headers={["Tarefa", "Responsável", "Status", "Ação"]} rows={tasks.slice().reverse().map((task) => [task.title, task.owner || "Não atribuído", task.status || "Aberta", <button className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700" key={task.id} onClick={() => deleteTask(task)} type="button">Excluir tarefa</button>])} /></div></section></section>;
  }

  if (active === "Configurações") {
    content = <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-5"><h2 className="font-semibold">Configurações</h2><p className="mt-2 text-sm text-slate-500">Padronize as visões operacionais e os destinatários das notificações por núcleo.</p></div>
      <div className="flex gap-2 border-b border-slate-100 px-6 pt-4"><button className={cn("rounded-t-xl px-4 py-2 text-sm font-semibold", settingsTab === "premissas" ? "bg-emerald-50 text-emerald-800" : "text-slate-500")} onClick={() => setSettingsTab("premissas")} type="button">Visões e premissas</button><button className={cn("rounded-t-xl px-4 py-2 text-sm font-semibold", settingsTab === "email" ? "bg-emerald-50 text-emerald-800" : "text-slate-500")} onClick={() => setSettingsTab("email")} type="button">E-mails por núcleo</button></div>
      {settingsTab === "premissas" ? <div className="space-y-5 p-6"><div className="max-w-xl rounded-xl border border-emerald-200 bg-emerald-50 p-4"><label className="grid gap-1.5 text-sm font-semibold text-emerald-950">Ciclo exibido na visão DAE<select className="rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800" onChange={(event) => setDashboardSettings({ daeCycle: event.target.value as DashboardSettings["daeCycle"] })} value={dashboardSettings.daeCycle}><option>Safra</option><option>Safrinha</option><option>Ambos</option></select></label><p className="mt-2 text-xs text-emerald-900">A visão geral mostrará a idade desde o plantio por núcleo apenas para o ciclo escolhido.</p></div><div><p className="text-sm text-slate-500">Ajuste dimensões, conversões e regras que sustentam as análises.</p><button className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white" onClick={() => setShowPremises(true)} type="button"><SlidersHorizontal className="h-4 w-4" />Editar premissas</button></div></div> : <div className="space-y-5 p-6"><div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><p className="font-semibold">Envio por domínio corporativo</p><p className="mt-1 text-xs">Os destinatários abaixo são sugeridos no envio manual de alertas. Use endereços internos @agroboaesperanca.com.br, separados por vírgula.</p></div><label className="grid max-w-xl gap-1.5 text-sm font-medium">Cópia padrão (CC)<input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" onChange={(event) => setEmailSettings((current) => ({ ...current, defaultCopy: event.target.value }))} placeholder="planejamento@agroboaesperanca.com.br" value={emailSettings.defaultCopy} /></label><div><h3 className="text-sm font-semibold">Destinatário padrão por núcleo</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{taskNuclei.filter((nucleus) => nucleus !== "Todos").map((nucleus) => <label className="grid gap-1.5 text-sm font-medium" key={nucleus}>{nucleus}<input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" onChange={(event) => setEmailSettings((current) => ({ ...current, nucleusRecipients: { ...current.nucleusRecipients, [nucleus]: event.target.value } }))} placeholder={`responsavel.${nucleus.toLowerCase()}@agroboaesperanca.com.br`} value={emailSettings.nucleusRecipients[nucleus] || ""} /></label>)}</div>{taskNuclei.length === 1 ? <p className="mt-3 text-sm text-slate-500">Os núcleos aparecem após a importação de pedidos pendentes.</p> : null}</div></div>}
    </section>;
  }

  if (active === "Visão geral" && hasData) {
    const overviewContent = content;
    content = <section className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-emerald-700">Centro de decisão</p><h2 className="mt-1 text-xl font-bold text-emerald-950">Prioridades de hoje</h2><p className="mt-1 text-sm text-emerald-900">{isOperator ? `Leitura operacional do núcleo ${operatorHasNucleus ? operatorNucleus : "ainda não definido"}.` : "Leitura rápida de riscos, tarefas e abastecimento antes da análise detalhada."}</p></div><div className="flex gap-2"><button className="rounded-xl border border-emerald-700 bg-white px-3 py-2 text-sm font-bold text-emerald-800" onClick={() => void exportExecutiveReport()} type="button"><Download className="mr-2 inline h-4 w-4" />Relatório executivo</button><button className="rounded-xl bg-emerald-800 px-3 py-2 text-sm font-bold text-white" onClick={() => window.print()} type="button">Imprimir / PDF</button></div></div>{isOperator && !operatorHasNucleus ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>Acesso aguardando configuração.</strong> Um administrador precisa definir o núcleo deste usuário antes de liberar os dados operacionais.</div> : null}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card label="Riscos críticos" value={scopedOperationalAlerts.filter((alert) => alert.severity === "critical").length} note="estoque vencido, dose ou cobertura" tone="rose" /><Card label="Pendências de qualidade" value={dashboardQualityPending} note={isOperator ? "sem pendências no escopo do núcleo" : "conciliação e validações de importação"} tone={dashboardQualityPending ? "amber" : "emerald"} /><Card label="Tarefas abertas" value={openTasks.length} note={overdueTasks ? `${overdueTasks} com prazo vencido` : "sem prazo vencido"} tone={overdueTasks ? "amber" : "slate"} /><Card label="Pedidos urgentes" value={farol.alert + farol.attention} note="ponto de atenção ou alerta" tone={farol.alert ? "rose" : "amber"} /></div><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="font-semibold">Fila operacional</h3><p className="mt-1 text-xs text-slate-500">Itens que merecem decisão ou acompanhamento imediato.</p></div><button className="text-xs font-bold text-emerald-800" onClick={() => setActive("Alertas")} type="button">Ver alertas</button></div><div className="grid gap-2">{dailyPriorities.length ? dailyPriorities.map((item) => <article className={cn("rounded-xl border px-4 py-3", item.tone === "rose" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50/60")} key={item.id}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-600">{item.level}</p><p className="mt-1 text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-1 text-xs leading-relaxed text-slate-600">{item.detail}</p></div></div></article>) : <p className="py-4 text-sm text-slate-500">Não há prioridades críticas no recorte atual.</p>}</div></section>{overviewContent}</section>;
  }

  if (active === "Importações") {
    const importsContent = content;
    content = <section className="space-y-6"><section className="grid gap-3 sm:grid-cols-3"><Card label="Qualidade da base" value={qualityPending ? `${qualityPending} pendências` : "Base consistente"} note={`${reconciliationIssues.length} itens para conciliar`} tone={qualityPending ? "amber" : "emerald"} /><Card label="Últimas importações" value={importHistory.length} note="versões registradas" /><Card label="Validações do arquivo" value={qualityWarnings} note="campos essenciais sem leitura" tone={qualityWarnings ? "amber" : "emerald"} /></section>{importsContent}<section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4"><h2 className="font-semibold">Histórico e versões de importação</h2><p className="mt-1 text-xs text-slate-500">Cada importação preserva data, versão, comparação de linhas e validações encontradas.</p></div><Table empty="Nenhuma importação registrada nesta base." headers={["Fonte", "Arquivo", "Versão", "Linhas", "Variação", "Validações", "Importada em"]} rows={importHistory.slice(0, 20).map((entry) => [sourceConfig.find((source) => source.key === entry.source)?.title || entry.source, entry.fileName, `v${entry.version}`, formatNumber(entry.rows), entry.previousRows ? `${entry.rows >= entry.previousRows ? "+" : ""}${formatNumber(entry.rows - entry.previousRows)}` : "Primeira carga", entry.warnings ? <span className="font-bold text-amber-700" key={entry.id}> {entry.warnings}</span> : "OK", formatDateTime(entry.importedAt)])} /></section></section>;
  }

  if (active === "Tarefas") {
    const tasksContent = content;
    content = <section className="space-y-6"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">Gestão de responsabilidade</h2><p className="mt-1 text-xs text-slate-500">Defina responsável, prazo, status e a referência da evidência de cada ação.</p></div><div className="grid grid-cols-3 gap-2 text-center text-xs"><span className="rounded-lg bg-sky-50 px-3 py-2 font-bold text-sky-800">{tasks.filter((task) => task.status === "Aberta").length} abertas</span><span className="rounded-lg bg-amber-50 px-3 py-2 font-bold text-amber-800">{tasks.filter((task) => task.status === "Em andamento").length} em curso</span><span className="rounded-lg bg-emerald-50 px-3 py-2 font-bold text-emerald-800">{tasks.filter((task) => task.status === "Concluída").length} concluídas</span></div></div><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr>{["Tarefa", "Responsável", "Prazo", "Status", "Evidência / link", "Atualizada"].map((head) => <th className="px-3 py-3 font-semibold" key={head}>{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{tasks.length ? tasks.slice().reverse().map((task) => <tr key={task.id}><td className="px-3 py-3 font-semibold text-slate-800">{task.title}<p className="mt-1 text-xs font-normal text-slate-500">{task.material || "Sem material"}{task.nucleus ? ` · ${task.nucleus}` : ""}</p></td><td className="px-3 py-3"><input aria-label={`Responsável por ${task.title}`} className="w-40 rounded-lg border border-slate-200 px-2 py-1.5" onBlur={(event) => updateTask(task.id, { owner: event.target.value })} defaultValue={task.owner || ""} /></td><td className="px-3 py-3"><input aria-label={`Prazo para ${task.title}`} className="rounded-lg border border-slate-200 px-2 py-1.5" onChange={(event) => updateTask(task.id, { dueDate: event.target.value })} type="date" value={task.dueDate || ""} /></td><td className="px-3 py-3"><select aria-label={`Status de ${task.title}`} className="rounded-lg border border-slate-200 px-2 py-1.5" onChange={(event) => updateTask(task.id, { status: event.target.value as TaskStatus })} value={task.status || "Aberta"}>{["Aberta", "Em andamento", "Aguardando", "Concluída"].map((status) => <option key={status}>{status}</option>)}</select></td><td className="px-3 py-3"><input aria-label={`Evidência de ${task.title}`} className="w-48 rounded-lg border border-slate-200 px-2 py-1.5" onBlur={(event) => updateTask(task.id, { evidence: event.target.value })} placeholder="Link, chamado ou referência" defaultValue={task.evidence || ""} /></td><td className="px-3 py-3 text-xs text-slate-500">{formatDateTime(task.updatedAt || task.createdAt)}</td></tr>) : <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={6}>Registre uma ação abaixo para começar o acompanhamento.</td></tr>}</tbody></table></div></section>{tasksContent}</section>;
  }

  if (active === "Configurações") {
    const settingsContent = content;
    content = <section className="space-y-6">{settingsContent}<section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4"><h2 className="font-semibold">Auditoria recente</h2><p className="mt-1 text-xs text-slate-500">Registro de alterações relevantes feitas na base operacional.</p></div><Table empty="Ainda não há eventos registrados nesta sessão." headers={["Quando", "Responsável", "Tipo", "Detalhe"]} rows={auditEvents.slice(0, 15).map((event) => [formatDateTime(event.createdAt), event.actor, event.kind, event.detail])} /></section></section>;
  }

  if (active === "Usuários" && currentUser?.role === "admin") {
    content = <section className="space-y-5"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Administração de acesso</p><h2 className="mt-1 text-xl font-bold text-emerald-950">Usuários e escopo operacional</h2><p className="mt-2 text-sm text-emerald-900">Operadores são direcionados para o núcleo definido. O Acompanhamento permanece comparativo e geral.</p></div><div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]"><section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h3 className="font-semibold">Contas cadastradas</h3><p className="mt-1 text-xs text-slate-500">Defina o núcleo dos operadores para priorizar suas análises.</p></div><button className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-700" onClick={() => void loadManagedUsers()} type="button">Atualizar</button></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr>{["Usuário", "Login", "Perfil", "Núcleo", "Ações"].map((head) => <th className="px-4 py-3 font-semibold" key={head}>{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{managedUsers.map((user) => <tr key={user.id}><td className="px-4 py-4 font-semibold text-slate-800">{user.name}</td><td className="px-4 py-4 text-slate-600">{user.username}</td><td className="px-4 py-4"><span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", user.role === "admin" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700")}>{user.role === "admin" ? "Administrador" : "Operador"}</span></td><td className="px-4 py-4 font-medium text-emerald-800">{user.role === "admin" ? "Todos" : user.nucleus || "Definir núcleo"}</td><td className="px-4 py-4"><div className="flex gap-2"><button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700" onClick={() => editManagedUser(user)} type="button">Editar</button><button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-40" disabled={user.id === currentUser.id || userManagerLoading} onClick={() => void removeManagedUser(user)} type="button">Excluir</button></div></td></tr>)}{!managedUsers.length ? <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={5}>Nenhum usuário encontrado.</td></tr> : null}</tbody></table></div></section><form className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={saveManagedUser}><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{userDraft.id ? "Editar usuário" : "Novo usuário"}</h3><p className="mt-1 text-xs text-slate-500">Operadores só acessam as análises priorizadas para seu núcleo.</p></div>{userDraft.id ? <button className="text-xs font-bold text-slate-500" onClick={() => setUserDraft(emptyUserDraft)} type="button">Cancelar</button> : null}</div><div className="mt-5 grid gap-3"><label className="grid gap-1 text-xs font-bold text-slate-600">Nome<input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setUserDraft((current) => ({ ...current, name: event.target.value }))} required value={userDraft.name} /></label><label className="grid gap-1 text-xs font-bold text-slate-600">Login<input autoCapitalize="none" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setUserDraft((current) => ({ ...current, username: event.target.value }))} required value={userDraft.username} /></label><label className="grid gap-1 text-xs font-bold text-slate-600">Perfil<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" onChange={(event) => setUserDraft((current) => ({ ...current, role: event.target.value as UserDraft["role"] }))} value={userDraft.role}><option value="viewer">Operador</option><option value="admin">Administrador</option></select></label><label className="grid gap-1 text-xs font-bold text-slate-600">Núcleo do operador<select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal disabled:bg-slate-50" disabled={userDraft.role === "admin"} onChange={(event) => setUserDraft((current) => ({ ...current, nucleus: event.target.value }))} value={userDraft.role === "admin" ? "" : userDraft.nucleus}><option value="">Selecione o núcleo</option>{[...new Set([...ledger.map((row) => row.nucleus), ...taskNuclei.filter((nucleus) => nucleus !== "Todos")])].filter(Boolean).sort().map((nucleus) => <option key={nucleus}>{nucleus}</option>)}</select></label><label className="grid gap-1 text-xs font-bold text-slate-600">{userDraft.id ? "Nova senha (opcional)" : "Senha inicial"}<input autoComplete="new-password" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" minLength={6} onChange={(event) => setUserDraft((current) => ({ ...current, password: event.target.value }))} required={!userDraft.id} type="password" value={userDraft.password} /></label></div>{userManagerMessage ? <p className={cn("mt-4 rounded-xl px-3 py-2 text-sm", /atualizado|criado|excluído/i.test(userManagerMessage) ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800")}>{userManagerMessage}</p> : null}<button className="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-60" disabled={userManagerLoading} type="submit">{userManagerLoading ? "Salvando..." : userDraft.id ? "Salvar alterações" : "Criar usuário"}</button></form></div></section>;
  }

  if (active === "Importações" && currentUser?.role !== "admin") {
    content = <section className="space-y-6"><div className="rounded-2xl border border-sky-200 bg-sky-50 p-5"><h2 className="font-semibold text-sky-950">Importações em modo consulta</h2><p className="mt-1 text-sm text-sky-900">Seu perfil pode acompanhar arquivos, versões e validações, mas não pode importar ou substituir dados operacionais.</p></div><section className="rounded-2xl border border-slate-200 bg-white p-5"><Table empty="Nenhuma importação registrada." headers={["Fonte", "Arquivo", "Versão", "Linhas", "Validações", "Importada em"]} rows={importHistory.slice(0, 30).map((entry) => [sourceConfig.find((source) => source.key === entry.source)?.title || entry.source, entry.fileName, `v${entry.version}`, formatNumber(entry.rows), entry.warnings || "OK", formatDateTime(entry.importedAt)])} /></section></section>;
  }

  if (!authReady || (currentUser && !storageReady)) return <main className="login-screen grid min-h-screen place-items-center p-5"><ContentLoading detail="Conectando à base central e preparando seu ambiente." /></main>;
  if (!currentUser) return <LoginScreen error={loginError || persistenceError} loading={loggingIn} onPasswordChange={setLoginPassword} onSubmit={signIn} onUsernameChange={setLoginUsername} password={loginPassword} username={loginUsername} />;

  return <main className="app-shell min-h-screen bg-[#f2f5ef] text-slate-900" data-theme={dark ? "dark" : "light"}><Navigation active={active} alertCount={operationalAlerts.length + farol.alert} lastUpdatedAt={latestDataUpdate} onSelect={setActive} /><div className="lg:pl-[264px]"><header className="command-header sticky top-0 z-10 flex min-h-[64px] items-center justify-between gap-3 border-b border-emerald-950/10 bg-[#f8faf6]/95 px-4 py-2.5 lg:min-h-[72px] lg:px-9"><div className="flex min-w-0 items-center gap-2"><button aria-label="Abrir menu" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 lg:hidden" onClick={() => setShowMobileNav(true)} type="button"><Menu className="h-5 w-5" /></button><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{active}</p><p className="mt-0.5 truncate text-xs font-medium text-slate-500">Safra 2026/2027 · {hasData ? "base operacional ativa" : "base ainda não carregada"}</p></div></div><div className="flex shrink-0 items-center gap-2"><button aria-label="Alternar modo de cor" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-emerald-400 hover:text-emerald-800" onClick={toggleTheme} type="button">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button><button aria-label="Abrir premissas" className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-emerald-500 hover:text-emerald-800" onClick={() => setShowPremises(true)} type="button"><SlidersHorizontal className="h-4 w-4" /><span className="hidden sm:inline">Premissas</span></button></div></header><div className="mx-auto max-w-[1540px] px-4 py-6 pb-24 sm:px-5 sm:py-7 lg:px-9 lg:py-9 lg:pb-9"><section className="page-intro mb-7 flex flex-wrap items-end justify-between gap-3 sm:mb-8 sm:gap-4"><div><h1 className="text-[1.75rem] font-bold tracking-tight text-emerald-950 sm:text-4xl">{active}</h1>{active !== "Fechamentos" ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">{hasData ? "Dados carregados, conciliados e prontos para leitura operacional." : "Importe as fontes para ativar a leitura operacional e a conciliação de materiais."}</p> : null}</div>{active !== "Fechamentos" ? <div className={cn("rounded-xl border px-3 py-2 text-xs font-bold", hasData ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900")}>{hasData ? "Base pronta para análise" : "Aguardando fontes"}</div> : null}</section>{content}</div></div><nav aria-label="Atalhos principais" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-emerald-950/10 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden">{[nav[0], nav[1], nav[2], nav[4]].map(([label, Icon]) => <button className={cn("grid min-h-12 place-items-center gap-1 rounded-lg px-1 text-[10px] font-bold", active === label ? "bg-emerald-800 text-white" : "text-slate-600")} key={label} onClick={() => setActive(label)} type="button"><Icon className="h-4 w-4" /><span className="max-w-full truncate">{label}</span></button>)}<button className="grid min-h-12 place-items-center gap-1 rounded-lg px-1 text-[10px] font-bold text-slate-600" onClick={() => setShowMobileNav(true)} type="button"><Menu className="h-4 w-4" /><span>Mais</span></button></nav>{showMobileNav ? <div aria-modal="true" className="fixed inset-0 z-50 flex items-end bg-emerald-950/40 p-3 lg:hidden" role="dialog"><div className="w-full rounded-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-lg font-bold">Navegação</h2><p className="text-xs text-slate-500">Acesse todas as áreas operacionais.</p></div><button aria-label="Fechar menu" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200" onClick={() => setShowMobileNav(false)} type="button"><X className="h-5 w-5" /></button></div><div className="grid grid-cols-2 gap-2">{nav.map(([label, Icon]) => <button className={cn("flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left text-sm font-bold", active === label ? "border-emerald-700 bg-emerald-50 text-emerald-950" : "border-slate-200 text-slate-700")} key={label} onClick={() => { setActive(label); setShowMobileNav(false); }} type="button"><Icon className="h-4 w-4" />{label}</button>)}</div></div></div> : null}

    {showNotification ? (
      <div aria-labelledby="task-notification-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog">
        <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
            <h2 className="font-semibold" id="task-notification-title">Notificar pedidos pendentes</h2>
            <button aria-label="Fechar notificação" className="p-2 text-slate-500" onClick={closeNotification} type="button"><X aria-hidden="true" className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-4 p-6 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Núcleo
              <select className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" onChange={(event) => {
                const nucleus = event.target.value;
                setNotificationNucleus(nucleus);
                setNotificationTo(emailSettings.nucleusRecipients[nucleus] || "");
                setNotificationMessage(null);
              }} value={notificationNucleus}>
                {taskNuclei.map((nucleus) => <option key={nucleus}>{nucleus}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Atraso a partir de
              <select className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" onChange={(event) => {
                setNotificationDays(event.target.value);
                setNotificationMessage(null);
              }} value={notificationDays}>
                {[1, 3, 5, 7, 10].map((days) => <option key={days} value={days}>{days} {days === 1 ? "dia" : "dias"}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Para
              <input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" onChange={(event) => setNotificationTo(event.target.value)} placeholder="responsavel@empresa.com" value={notificationTo} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Cópia (CC)
              <input className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal" onChange={(event) => setNotificationCc(event.target.value)} placeholder="planejamento@empresa.com" value={notificationCc} />
            </label>
            {notificationDraft?.incompleteRows || notificationSource || notificationSourceLoading ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 sm:col-span-2">
                <p className="min-w-0 break-words text-xs text-slate-600" role="status">
                  {notificationSourceLoading ? "Lendo a planilha…" : notificationSource
                    ? `Planilha deste rascunho · ${notificationSource.name}`
                    : "Use PEDIDOS PENDENTES.xlsx para recuperar os campos ausentes neste rascunho."}
                </p>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-800 focus-within:outline-2 focus-within:outline-emerald-700 has-disabled:cursor-wait has-disabled:opacity-50">
                  <FileUp aria-hidden="true" className="h-4 w-4" />
                  {notificationSource ? "Trocar planilha" : "Completar com Excel"}
                  <input accept=".xlsx,.xls" className="sr-only" disabled={notificationSourceLoading} onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void loadNotificationSource(file);
                  }} type="file" />
                </label>
              </div>
            ) : null}
            {notificationDraft ? (
              <details className="rounded-xl border border-slate-200 p-3 sm:col-span-2">
                <summary className="cursor-pointer text-sm font-semibold">Prévia do e-mail</summary>
                <p className="mt-2 text-sm">{notificationDraft.subject}</p>
                <iframe className="mt-2 h-72 w-full rounded-lg bg-white" sandbox="" srcDoc={notificationDraft.html} title="Corpo do e-mail de pedidos pendentes" />
              </details>
            ) : null}
          </div>
          <div className="border-t border-slate-100 px-6 py-4">
            <p className="text-sm text-slate-600">{notificationDraft
              ? `${notificationDraft.count} ${notificationDraft.count === 1 ? "linha de pedido no rascunho" : "linhas de pedido no rascunho"}.`
              : "Nenhum pedido pendente na faixa e no núcleo selecionados."}</p>
            {notificationDraft?.incompleteRows ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-900">
                <p>{notificationDraft.incompleteRows === 1
                  ? "Uma linha tem campos ausentes na base."
                  : `${notificationDraft.incompleteRows} linhas têm campos ausentes na base.`}
                </p>
                {currentUser.role === "admin" ? (
                  <button className="font-semibold underline" onClick={() => {
                    closeNotification();
                    setActive("Importações");
                    window.scrollTo({ top: 0 });
                  }} type="button">Abrir Importações</button>
                ) : null}
              </div>
            ) : null}
            {notificationDraft ? (
              <p className="mt-2 text-xs text-slate-600">Para usar a sua assinatura, copie o corpo, abra uma nova mensagem no Outlook e cole no início do corpo. Se necessário, selecione a assinatura em <strong>Mensagem → Assinatura</strong>.</p>
            ) : null}
            {notificationMessage ? <p className={cn("mt-2 text-sm", notificationMessage.success ? "text-emerald-800" : "text-rose-700")} role="status">{notificationMessage.text}</p> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600" onClick={closeNotification} type="button">Cancelar</button>
              <button className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50" disabled={!notificationDraft || notificationSourceLoading} onClick={downloadNotificationDraft} type="button">Baixar .eml</button>
              <button className="rounded-xl border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50" disabled={!notificationDraft || notificationSourceLoading} onClick={() => void copyNotificationBody()} type="button">Copiar corpo formatado</button>
              {outlookDraftUrl ? (
                <a
                  className="inline-flex items-center rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
                  href={outlookDraftUrl}
                  onClick={() => setNotificationMessage({
                    text: "No Outlook, confira a conta remetente e cole o corpo acima da assinatura. Se a janela não abrir, use Novo E-mail no Outlook clássico.",
                    success: true,
                  })}
                >Nova mensagem no Outlook</a>
              ) : (
                <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!notificationDraft || notificationSourceLoading} onClick={() => setNotificationMessage({ text: "Informe um destinatário válido e confira os endereços em cópia." })} type="button">Nova mensagem no Outlook</button>
              )}
            </div>
          </div>
        </div>
      </div>
    ) : null}

    {showProvision ? <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog"><div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="font-semibold">Provisionamento micro</h2><p className="mt-1 text-xs text-slate-500">As linhas abaixo detalham fazenda, armazém, trânsito e pedidos pendentes do mesmo material.</p></div><div className="flex items-center gap-2"><button className="inline-flex items-center gap-2 rounded-lg border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-700" onClick={exportProvision} type="button"><Download className="h-4 w-4" />Exportar Excel</button><button aria-label="Fechar provisionamento" className="p-2 text-slate-500" onClick={() => setShowProvision(false)} type="button"><X className="h-4 w-4" /></button></div></div><div className="grid gap-4 border-b border-slate-100 p-6 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Início<input className="rounded-lg border border-slate-200 px-3 py-2" onChange={(event) => setEvaluationDate(event.target.value)} type="date" value={evaluationDate} /></label><label className="grid gap-1.5 text-sm font-medium">Fim<input className="rounded-lg border border-slate-200 px-3 py-2" onChange={(event) => setProvisionUntil(event.target.value)} type="date" value={provisionUntil} /></label></div><div className="grid gap-3 border-b border-slate-100 p-6 sm:grid-cols-5"><Card label="Demanda" value={formatNumber(provision.demand)} /><Card label="Saldo em fazenda" value={formatNumber(provision.farm)} /><Card label="Trânsito" value={formatNumber(provision.transit)} /><Card label="Volume solicitado" value={formatNumber(provision.pendingOrder)} note="pedidos pendentes" /><Card label="Apoio do armazém" value={formatNumber(provision.warehouse)} note="saldo central compartilhado" /></div><p className="px-6 py-3 text-xs text-slate-500">{provision.dated ? "A demanda foi filtrada por DT_Aplicacao do planejamento." : "Não foi encontrada data prevista reconhecida: a janela usa todas as linhas."}</p><div className="min-h-0 flex-1 overflow-auto border-t border-slate-100"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr>{["Núcleo", "Princípio ativo", "Material padrão", "Demanda", "Saldo", "Trânsito", "V. solicitado", "Situação"].map((head) => <th className="px-4 py-3 font-semibold" key={head}>{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{provision.rows.map((row) => <Fragment key={row.id}><tr><td className="px-4 py-3 font-medium">{row.nucleus}</td><td className="px-4 py-3">{row.active}</td><td className="px-4 py-3 font-medium">{row.standardMaterial}</td><td className="px-4 py-3">{formatNumber(row.demand)}</td><td className="px-4 py-3">{formatNumber(row.farmBalance)}</td><td className="px-4 py-3">{formatNumber(row.transit)}</td><td className="px-4 py-3 font-semibold text-emerald-700">{formatNumber(row.pendingOrder)}</td><td className={cn("px-4 py-3 font-semibold", row.status === "Falta" ? "text-rose-700" : "text-emerald-700")}>{row.status}</td></tr>{[...row.locations.filter((location) => location.type !== "Armazém"), ...row.warehouseLocations].map((location, index) => <tr className="bg-slate-50/70 text-xs" key={row.id + "|" + location.type + "|" + location.location + "|" + String(index)}><td className="py-2 pl-8 pr-4 text-slate-500">{location.type}</td><td className="px-4 py-2 text-slate-500" colSpan={2}>{location.location}</td><td className="px-4 py-2 text-slate-500" colSpan={2}>{location.material}</td><td className="px-4 py-2 font-medium">{formatNumber(location.amount)}</td><td className="px-4 py-2 text-slate-400">—</td><td className="px-4 py-2 text-slate-500">{location.type === "Armazém" ? "Apoio possível" : "Saldo localizado"}</td></tr>)}</Fragment>)}{!provision.rows.length ? <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={8}>Não há demanda planejada para esta janela.</td></tr> : null}</tbody></table></div></div></div> : null}

    {showPremises ? <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog"><div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="font-semibold">Premissas e dimensões</h2><p className="mt-1 text-xs text-slate-500">Regras operacionais e mapeamentos aplicados à conciliação.</p></div><button aria-label="Fechar premissas" className="p-2 text-slate-500" onClick={() => setShowPremises(false)} type="button"><X className="h-4 w-4" /></button></div><div className="grid gap-4 p-6 sm:grid-cols-2">{[["Tolerância de desvio (%)", "tolerance"], ["Amostra mínima", "sample"], ["Janelas de demanda", "horizon"], ["Status excluído", "excludedStatus"]].map(([label, key]) => <label className="grid gap-1.5 text-sm font-medium" key={key}>{label}<input className="rounded-lg border border-slate-200 px-3 py-2" onChange={(event) => setPremises({ ...premises, [key]: event.target.value })} value={premises[key as keyof Premises]} /></label>)}</div><div className="border-t border-slate-100 px-6 py-5"><h3 className="text-sm font-semibold">Nova premissa de dimensão</h3><p className="mt-1 text-xs text-slate-500">Material: nome → material agregado. Centro/Fazenda: chave → núcleo. Conversão: material padrão|apresentação física → fator.</p><div className="mt-3 grid gap-2 sm:grid-cols-4"><select className="rounded-lg border border-slate-200 px-2 py-2 text-sm" onChange={(event) => setDraft({ ...draft, domain: event.target.value })} value={draft.domain}><option>Material</option><option>Princípio ativo</option><option>Centro</option><option>Fazenda</option><option>Cultura</option><option>Conversão</option></select><input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onChange={(event) => setDraft({ ...draft, key: event.target.value })} placeholder="Chave" value={draft.key} /><input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder="Valor" value={draft.value} /><button className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700" onClick={addPremise} type="button">Incluir</button></div>{dimensionPremises.length ? <div className="mt-4 space-y-2">{dimensionPremises.map((item, index) => <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs" key={item.domain + "|" + item.key + "|" + String(index)}><span>{item.domain}: <strong>{item.key}</strong> → {item.value}</span><button className="text-rose-600" onClick={() => setDimensionPremises((current) => current.filter((_, position) => position !== index))} type="button">Remover</button></div>)}</div> : null}</div><div className="border-t border-slate-100 px-6 py-5"><div className="mb-4"><h3 className="text-sm font-semibold">Catálogo de premissas</h3><p className="mt-1 text-xs text-slate-500">Escolha um tipo para consultar os dados em tabela e exportá-los para edição.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{premiseSections.map((section) => <button className={cn("rounded-xl border p-4 text-left", premiseSection === section.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:border-emerald-300")} key={section.id} onClick={() => setPremiseSection(section.id)} type="button"><p className="text-sm font-semibold">{section.title}</p><p className="mt-1 text-xs text-slate-500">{section.rows.length} registros</p></button>)}</div><div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold">{selectedPremiseSection.title}</h4><p className="mt-1 text-xs text-slate-500">{selectedPremiseSection.description}</p></div><button className="inline-flex items-center gap-2 rounded-lg border border-emerald-700 bg-white px-3 py-2 text-xs font-semibold text-emerald-700" onClick={exportPremiseSection} type="button"><Download className="h-4 w-4" />Exportar para edição</button></div><Table empty="Nenhum registro nesta premissa." headers={selectedPremiseSection.headers} rows={selectedPremiseSection.rows} /></div></div><div className="border-t border-slate-100 px-6 py-5"><div className="rounded-xl border border-sky-200 bg-sky-50 p-4"><p className="text-sm font-semibold text-sky-950">Alertas por e-mail</p><p className="mt-1 text-xs leading-relaxed text-sky-900">A programação de destinatários e frequência será habilitada assim que o serviço de envio for autorizado. A plataforma já sinaliza os alertas operacionais no painel.</p></div></div><div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4"><button className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600" onClick={() => setShowPremises(false)} type="button">Cancelar</button><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => { setShowPremises(false); setMessage("Premissas aplicadas e salvas na base central."); }} type="button">Salvar</button></div></div></div> : null}
  </main>;
}
