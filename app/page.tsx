"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { DimensionUpload } from "@/components/dimension-upload";
import { emptyDimensionBundle, normalizeMaterial, type DimensionBundle } from "@/lib/material-dimension";
import {
  buildFarmToNucleus,
  buildReconciliation,
  cultureFor,
  cycleFor,
  headerKey,
  numberFrom,
  nucleusFor,
  planningNucleusFor,
  productFor,
  readNumber,
  readText,
  standardAmount,
  standardQuantity,
  type OperationalRow,
  type ReconciliationRow,
} from "@/lib/reconciliation";
import {
  AlertTriangle, BarChart3, Bell, CalendarDays, CheckCircle2, ChevronDown,
  ClipboardCheck, Download, FileUp, LayoutDashboard, Moon, PackageSearch,
  Search, Settings, ShieldCheck, SlidersHorizontal, Sprout, Sun, Upload,
  UsersRound, X,
} from "lucide-react";

type Row = OperationalRow;
type SourceKey = "planejamento" | "execucao" | "consumo" | "estoque" | "transito";
type Datasets = Record<SourceKey, Row[]>;
type ImportSummary = { fileName: string; rows: number; sheets: string[] };
type Premises = { tolerance: string; sample: string; horizon: string; excludedStatus: string };
type DimensionPremise = { domain: string; key: string; value: string };

const emptyDatasets: Datasets = { planejamento: [], execucao: [], consumo: [], estoque: [], transito: [] };
const initialPremises: Premises = { tolerance: "5", sample: "3", horizon: "7, 15, 30", excludedStatus: "EXCL" };
const sourceConfig: Array<{ key: SourceKey; title: string; hint: string; header: number }> = [
  { key: "planejamento", title: "Planejamento", hint: "PLANEJAMENTO.xlsx", header: 0 },
  { key: "execucao", title: "Execução SAP", hint: "ZPS007.xlsx", header: 1 },
  { key: "consumo", title: "Consumo SAP", hint: "CN52.xlsx", header: 3 },
  { key: "estoque", title: "Estoque por lote", hint: "ZMM_BATCH.xlsx", header: 0 },
  { key: "transito", title: "Materiais em trânsito", hint: "MB5T.xlsx", header: 1 },
];
const nav = [
  ["Visão geral", LayoutDashboard], ["Calendarização", CalendarDays],
  ["Acompanhamento", ClipboardCheck], ["Execução", PackageSearch],
  ["Importações", FileUp], ["Alertas", Bell], ["Tarefas", ClipboardCheck],
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
function formatDose(value: number | null) { return value === null ? "n.a." : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function percent(value: number, total: number) { return total ? Math.max(0, Math.min(100, value * 100 / total)) : 0; }
function rawPercent(value: number, total: number) { return total ? value * 100 / total : 0; }
function percentageText(value: number, total: number) { return total > 0 ? rawPercent(value, total).toFixed(1) + "%" : "n.a."; }
function signedNumber(value: number | null) { return value === null ? "n.a." : (value > 0 ? "+" : "") + formatNumber(value); }
function dateKey(date: Date) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"); }

function dateFromPlan(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value ?? "").trim();
  const serial = Number(raw.replace(",", "."));
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const parsed = XLSX.SSF.parse_date_code(serial);
    return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d) : null;
  }
  const match = /^(\d{1,2})[/.\\-](\d{1,2})[/.\\-](\d{2,4})$/.exec(raw);
  if (match) {
    const year = Number(match[3].length === 2 ? "20" + match[3] : match[3]);
    return new Date(year, Number(match[2]) - 1, Number(match[1]));
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stockHeaderRow(sheet: XLSX.WorkSheet) {
  const preview = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }).slice(0, 8);
  const index = preview.findIndex((row) => {
    const headers = row.map(headerKey);
    return (headers.includes("CENTRO") || headers.includes("CEN"))
      && headers.includes(headerKey("Texto breve material"))
      && headers.includes(headerKey("Utilização livre"));
  });
  return index >= 0 ? index : 0;
}
function rowsFrom(workbook: XLSX.WorkBook, source: (typeof sourceConfig)[number]) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const header = source.key === "estoque" ? stockHeaderRow(sheet) : source.header;
  return XLSX.utils.sheet_to_json<Row>(sheet, { range: header, defval: "" });
}
function statusExcluded(row: Row, status: string) {
  return headerKey(readText(row, "Status", "Situação", "Situacao")) === headerKey(status);
}
function planningProduct(row: Row, excluded: string) {
  if (statusExcluded(row, excluded)) return false;
  const classification = readText(row, "Classificação", "Classificacao", "Classificac�o", "Tipo");
  return !classification || headerKey(classification).includes("PRODUTO");
}
function pendingHeaderRow(sheet: XLSX.WorkSheet) {
  const preview = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }).slice(0, 15);
  return preview.findIndex((row) => {
    const headers = row.map(headerKey);
    return headers.includes(headerKey("Descrição Material"))
      && (headers.includes(headerKey("Saldo Forn")) || headers.includes(headerKey("Qtd.pedido")));
  });
}
async function readPendingFile(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  for (const name of workbook.SheetNames) {
    const header = pendingHeaderRow(workbook.Sheets[name]);
    if (header < 0) continue;
    return XLSX.utils.sheet_to_json<Row>(workbook.Sheets[name], { range: header, defval: "" })
      .filter((row) => Boolean(readText(row, "Descrição Material", "Descricao Material", "Produto solicitado")))
      .filter((row) => !["SIM", "S", "X", "TRUE"].includes(headerKey(readText(row, "Eliminado?", "Eliminado", "Cancelado"))));
  }
  throw new Error("Não localizei Descrição Material e Saldo Forn no arquivo de pedidos pendentes.");
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
  const color = { slate: "border-slate-200 bg-white", amber: "border-amber-100 bg-amber-50/60", rose: "border-rose-100 bg-rose-50/60", emerald: "border-emerald-100 bg-emerald-50/60" }[tone];
  return <div className={cn("rounded-2xl border p-4", color)}><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>{note ? <p className="mt-1 text-xs text-slate-500">{note}</p> : null}</div>;
}
function Progress({ value }: { value: number }) {
  return <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: String(Math.max(0, Math.min(100, value))) + "%" }} /></div>;
}
function Table({ headers, rows, empty = "Nenhum dado no recorte." }: { headers: string[]; rows: ReactNode[][]; empty?: string }) {
  return <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="w-full min-w-max text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr>{headers.map((head) => <th className="whitespace-nowrap px-3 py-3 font-semibold" key={head}>{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td className="px-3 py-3 align-top" key={cellIndex}>{cell}</td>)}</tr>) : <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={headers.length}>{empty}</td></tr>}</tbody></table></div>;
}
function Empty({ title, description }: { title: string; description: string }) {
  return <div className="grid min-h-[240px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center"><div><PackageSearch className="mx-auto h-7 w-7 text-emerald-700" /><h2 className="mt-3 font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{description}</p></div></div>;
}
function Navigation({ active, onSelect }: { active: string; onSelect: (value: string) => void }) {
  return <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] border-r border-slate-200 bg-white px-4 py-5 lg:block"><div className="flex items-center gap-3 px-3 pb-7"><div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-700 text-white"><Sprout className="h-5 w-5" /></div><div><p className="text-sm font-bold">AgroNexus</p><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-emerald-700">Planejamento 360°</p></div></div><div className="space-y-1">{nav.map(([label, Icon], index) => <Fragment key={label}>{index === 4 ? <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Gestão</p> : null}<button className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium", active === label ? "bg-emerald-50 text-emerald-800" : "text-slate-600 hover:bg-slate-50")} onClick={() => onSelect(label)} type="button"><Icon className="h-4 w-4" />{label}</button></Fragment>)}</div><div className="absolute bottom-5 left-4 right-4 rounded-2xl bg-slate-900 p-4 text-white"><ShieldCheck className="h-5 w-5 text-emerald-300" /><p className="mt-3 text-xs font-semibold">Conciliação por nomes</p><p className="mt-1 text-[11px] leading-relaxed text-slate-300">Códigos SAP são somente diagnósticos; a chave operacional é o nome do material.</p></div></aside>;
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
  onQueryChange: (value: string) => void;
  onSubgroupChange: (value: string) => void;
  query: string;
  subgroupFilter: string;
  subgroups: string[];
};

function AnalysisFilters({
  cultures, cultureFilter, cycleFilter, cycles, groupFilter, groups,
  onCultureChange, onCycleChange, onGroupChange, onQueryChange, onSubgroupChange,
  query, subgroupFilter, subgroups,
}: AnalysisFiltersProps) {
  return <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-5">
    <label className="grid gap-1 text-xs font-semibold text-slate-600">Ciclo
      <select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => onCycleChange(event.target.value)} value={cycleFilter}>
        {cycles.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs font-semibold text-slate-600">Grupo
      <select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => onGroupChange(event.target.value)} value={groupFilter}>
        {groups.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs font-semibold text-slate-600">Subgrupo
      <select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => onSubgroupChange(event.target.value)} value={subgroupFilter}>
        {subgroups.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs font-semibold text-slate-600">Cultura
      <select className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" onChange={(event) => onCultureChange(event.target.value)} value={cultureFilter}>
        {cultures.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs font-semibold text-slate-600">Buscar
      <span className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" /><input className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-sm font-normal" onChange={(event) => onQueryChange(event.target.value)} placeholder="Produto ou princípio ativo" value={query} /></span>
    </label>
  </div>;
}

type DemandRow = ReconciliationRow & { demand: number; local: number };
type WarehouseAllocation = { allocated: number; locations: ReconciliationRow["locations"] };
type MonitoringRow = ReconciliationRow & { isWarehouseView?: boolean };
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

function StockDetails({ row }: { row: MonitoringRow }) {
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
        {materials.flatMap(([material, detail]) => [
          <tr className="bg-emerald-50/40" key={"material|" + material}><td className="px-3 py-2 font-semibold">Material</td><td className="px-3 py-2 font-semibold">{material}</td><td className="px-3 py-2">{formatNumber(detail.balance)}</td><td className="px-3 py-2">{formatNumber(detail.transit)}</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-500">{row.isWarehouseView ? "Estoque de armazém" : "Estoque do núcleo"}</td></tr>,
          ...detail.locations.map((location, index) => <tr key={["location", material, location.location, String(index)].join("|")}><td className="px-3 py-2 pl-7 text-slate-500">↳ Local</td><td className="px-3 py-2">{location.material}</td><td className="px-3 py-2">{location.type === "Trânsito" ? "—" : formatNumber(location.amount)}</td><td className="px-3 py-2">{location.type === "Trânsito" ? formatNumber(location.amount) : "—"}</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-400">—</td><td className="px-3 py-2 text-slate-600">{location.location}</td></tr>),
        ])}
        {!materials.length ? <tr><td className="px-3 py-5 text-center text-slate-500" colSpan={8}>Não há saldo ou trânsito detalhado para este material.</td></tr> : null}
      </tbody>
    </table>
  </div>;
}

export default function Home() {
  const [active, setActive] = useState("Visão geral");
  const [datasets, setDatasets] = useState<Datasets>(emptyDatasets);
  const [uploads, setUploads] = useState<Partial<Record<SourceKey, File>>>({});
  const [imports, setImports] = useState<Partial<Record<SourceKey, ImportSummary>>>({});
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [bundle, setBundle] = useState<DimensionBundle>(emptyDimensionBundle);
  const [pendingOrders, setPendingOrders] = useState<Row[]>([]);
  const [pendingLabel, setPendingLabel] = useState("Pedidos pendentes (opcional)");
  const [pendingError, setPendingError] = useState("");
  const [premises, setPremises] = useState<Premises>(initialPremises);
  const [dimensionPremises, setDimensionPremises] = useState<DimensionPremise[]>([]);
  const [draft, setDraft] = useState<DimensionPremise>({ domain: "Material", key: "", value: "" });
  const [showPremises, setShowPremises] = useState(false);
  const [showProvision, setShowProvision] = useState(false);
  const [dark, setDark] = useState(false);
  const [cycleFilter, setCycleFilter] = useState("Safra");
  const [groupFilter, setGroupFilter] = useState("Todos");
  const [subgroupFilter, setSubgroupFilter] = useState("Todos");
  const [cultureFilter, setCultureFilter] = useState("Todos");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [tasks, setTasks] = useState<string[]>([]);
  const [evaluationDate, setEvaluationDate] = useState(() => dateKey(new Date()));
  const [provisionUntil, setProvisionUntil] = useState(() => {
    const end = new Date();
    end.setDate(end.getDate() + 15);
    return dateKey(end);
  });

  useEffect(() => { setDark(window.localStorage.getItem("agronexus-theme") === "dark"); }, []);
  const toggleTheme = () => setDark((current) => {
    window.localStorage.setItem("agronexus-theme", current ? "light" : "dark");
    return !current;
  });

  const dimensions = useMemo(() => mergePremises(bundle, dimensionPremises), [bundle, dimensionPremises]);
  const plans = useMemo(() => datasets.planejamento.filter((row) => planningProduct(row, premises.excludedStatus)), [datasets.planejamento, premises.excludedStatus]);
  const farmToNucleus = useMemo(() => buildFarmToNucleus([...plans, ...datasets.execucao], dimensions, plans), [plans, datasets.execucao, dimensions]);
  const ledger = useMemo(() => buildReconciliation({
    bundle: dimensions, planningRows: plans, stockRows: datasets.estoque, transitRows: datasets.transito,
    consumptionRows: datasets.consumo, pendingRows: pendingOrders, farmToNucleus,
  }), [dimensions, plans, datasets.estoque, datasets.transito, datasets.consumo, pendingOrders, farmToNucleus]);

  const materialResolution = useMemo(() => {
    const input: Array<[Row[], "stock" | "transit" | "consumption"]> = [[datasets.estoque, "stock"], [datasets.transito, "transit"], [datasets.consumo, "consumption"]];
    let described = 0;
    let resolved = 0;
    input.forEach(([rows, source]) => rows.forEach((row) => {
      const product = productFor(row, source, dimensions);
      if (product.rawName === "Sem descrição") return;
      described += 1;
      if (product.resolvedByDimension) resolved += 1;
    }));
    return { described, resolved };
  }, [datasets.estoque, datasets.transito, datasets.consumo, dimensions]);

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
      const product = productFor(row, "planning", dimensions);
      ensure(cycleFor(row, dimensions), product.merchandiseGroup, product.subgroup).planned += standardQuantity(row, "planning", product, dimensions);
    });
    datasets.consumo.forEach((row) => {
      const product = productFor(row, "consumption", dimensions);
      ensure(cycleFor(row, dimensions), product.merchandiseGroup, product.subgroup).applied += standardQuantity(row, "consumption", product, dimensions);
    });
    return ["Safra", "Safrinha"].map((cycle) => ({
      cycle,
      rows: [...values.entries()].filter(([key]) => key.startsWith(cycle + "|")).map(([, value]) => value).sort((left, right) => right.planned - left.planned),
    }));
  }, [plans, datasets.consumo, dimensions]);

  const macroCrop = useMemo(() => crops.map((crop) => ({
    ...crop,
    applied: datasets.execucao
      .filter((row) => headerKey(readText(row, "Cultura", "WBS element", "WBS")).includes(crop.code))
      .reduce((sum, row) => sum + readNumber(row, "Área Executada", "Area Executada", "Qtde. executada"), 0),
  })), [datasets.execucao]);

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
      stockRows: datasets.estoque,
      transitRows: datasets.transito,
      consumptionRows: datasets.consumo.filter((row) => matchesScope(row, "consumption")),
      pendingRows: pendingOrders,
      farmToNucleus,
    });
  }, [cycleFilter, cultureFilter, datasets.consumo, datasets.estoque, datasets.transito, dimensions, farmToNucleus, groupFilter, pendingOrders, plans, subgroupFilter]);

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
        && (!search || line.includes(search));
    }).sort((left, right) => left.active.localeCompare(right.active)
      || left.standardMaterial.localeCompare(right.standardMaterial)
      || left.nucleus.localeCompare(right.nucleus));
  }, [cycleFilter, cultureFilter, groupFilter, monitoringLedger, query, subgroupFilter, warehouseMonitoringRows]);

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
      if ((cycleFilter !== "Todos" && cycleFor(row, dimensions) !== cycleFilter)
        || (groupFilter !== "Todos" && product.merchandiseGroup !== groupFilter)
        || (subgroupFilter !== "Todos" && product.subgroup !== subgroupFilter)
        || (cultureFilter !== "Todos" && cultureFor(row) !== cultureFilter)) return;
      const nucleus = planningNucleusFor(row, dimensions, farmToNucleus);
      const item = ensure(product, nucleus, cycleFor(row, dimensions), cultureFor(row));
      item.current.plannedVolume += standardQuantity(row, "planning", product, dimensions);
      item.current.plannedArea += planningArea(row);
    });

    const seenArea = new Set<string>();
    datasets.consumo.forEach((row) => {
      const product = productFor(row, "consumption", dimensions);
      if (product.rawName === "Sem descrição") return;
      if ((cycleFilter !== "Todos" && cycleFor(row, dimensions) !== cycleFilter)
        || (groupFilter !== "Todos" && product.merchandiseGroup !== groupFilter)
        || (subgroupFilter !== "Todos" && product.subgroup !== subgroupFilter)
        || (cultureFilter !== "Todos" && cultureFor(row) !== cultureFilter)) return;
      const nucleus = nucleusFor(row, dimensions, farmToNucleus);
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
  }, [plans, datasets.consumo, dimensions, farmToNucleus, executedAreaByTask, cycleFilter, groupFilter, subgroupFilter, cultureFilter]);

  const performanceRows = useMemo(() => {
    const search = normalizeMaterial(query);
    return executionPerformance.filter((row) => {
      const line = normalizeMaterial([row.active, row.standardMaterial, row.nucleus, row.subgroup, row.merchandiseGroup].join(" "));
      return (cycleFilter === "Todos" || row.cycles.includes(cycleFilter))
        && (groupFilter === "Todos" || row.merchandiseGroup === groupFilter)
        && (subgroupFilter === "Todos" || row.subgroup === subgroupFilter)
        && (cultureFilter === "Todos" || row.cultures.includes(cultureFilter))
        && (!search || line.includes(search));
    });
  }, [executionPerformance, cycleFilter, groupFilter, subgroupFilter, cultureFilter, query]);

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
      bundle: dimensions, planningRows: windowPlans, stockRows: datasets.estoque, transitRows: datasets.transito,
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
      const balance = row.local + warehouse.allocated - row.demand;
      const status = row.demand <= row.local ? "Atende no núcleo" : balance >= 0 ? "Atende com armazém" : "Falta";
      return { ...row, balance, status, warehouseSupport: warehouse.allocated, warehouseLocations: warehouse.locations };
    }).sort((left, right) => left.balance - right.balance || right.demand - left.demand);
    return {
      dated: scheduled.length > 0, rows,
      demand: rows.reduce((sum, row) => sum + row.demand, 0),
      farm: rows.reduce((sum, row) => sum + row.farmBalance, 0),
      transit: rows.reduce((sum, row) => sum + row.transit, 0),
      warehouse: allocation.totalAvailable,
    };
  }, [evaluationDate, provisionUntil, plans, dimensions, datasets.estoque, datasets.transito, datasets.consumo, pendingOrders, farmToNucleus]);

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

  async function importFiles() {
    const selected = sourceConfig.filter((source) => uploads[source.key]);
    if (!selected.length) { setMessage("Selecione ao menos uma fonte antes de importar."); return; }
    setImporting(true);
    setMessage("");
    try {
      const loaded = await Promise.all(selected.map(async (source) => {
        const file = uploads[source.key]!;
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const rows = rowsFrom(workbook, source);
        return { key: source.key, rows, summary: { fileName: file.name, rows: rows.length, sheets: workbook.SheetNames } };
      }));
      setDatasets((current) => ({ ...current, ...Object.fromEntries(loaded.map((item) => [item.key, item.rows])) }));
      setImports((current) => ({ ...current, ...Object.fromEntries(loaded.map((item) => [item.key, item.summary])) }));
      setUploads({});
      setMessage("Carga validada nesta sessão. Os visuais já usam as fontes importadas.");
      setActive("Visão geral");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível ler um dos arquivos.");
    } finally {
      setImporting(false);
    }
  }
  async function loadPending(file?: File) {
    if (!file) return;
    setPendingError("");
    try {
      const rows = await readPendingFile(file);
      setPendingOrders(rows);
      setPendingLabel(file.name + " — " + rows.length + " linhas válidas");
    } catch (error) {
      setPendingOrders([]);
      setPendingLabel("Pedidos pendentes (opcional)");
      setPendingError(error instanceof Error ? error.message : "Não foi possível ler os pedidos pendentes.");
    }
  }
  function addPremise() {
    if (!draft.key.trim() || !draft.value.trim()) return;
    setDimensionPremises((current) => [...current, { ...draft, key: draft.key.trim(), value: draft.value.trim() }]);
    setDraft((current) => ({ ...current, key: "", value: "" }));
  }
  function exportProvision() {
    const summary = provision.rows.map((row) => ({
      "Núcleo": row.nucleus, "Princípio ativo": row.active, Grupo: row.merchandiseGroup, Subgrupo: row.subgroup,
      "Material padrão": row.standardMaterial, "Demanda da janela": row.demand, "Saldo do núcleo": row.farmBalance,
      Trânsito: row.transit, "Apoio do armazém": row.warehouseSupport, "Saldo após atendimento": row.balance,
      "Volume solicitado": row.pendingOrder, Situação: row.status,
    }));
    const details = provision.rows.flatMap((row) => [
      ...row.locations.filter((location) => location.type !== "Armazém").map((location) => ({
        "Núcleo": row.nucleus, "Material padrão": row.standardMaterial, Material: location.material, Tipo: location.type, Local: location.location, "Saldo / trânsito": location.amount,
      })),
      ...row.warehouseLocations.map((location) => ({
        "Núcleo": row.nucleus, "Material padrão": row.standardMaterial, Material: location.material, Tipo: "Armazém", Local: location.location, "Saldo / trânsito": location.amount,
      })),
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), "Resumo");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(details), "Detalhes");
    XLSX.writeFile(workbook, "provisionamento_" + evaluationDate + "_" + provisionUntil + ".xlsx", { bookType: "xlsx" });
  }

  const totalPlanned = ledger.reduce((sum, row) => sum + row.planned, 0);
  const totalApplied = ledger.reduce((sum, row) => sum + row.applied, 0);
  const shortage = consolidatedSupply.shortage;
  const hasData = Object.keys(imports).length > 0;
  const excluded = datasets.execucao.filter((row) => statusExcluded(row, premises.excludedStatus)).length;

  let content: ReactNode;
  if (active === "Visão geral") {
    content = hasData ? <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card label="Execução de materiais" value={percent(totalApplied, totalPlanned).toFixed(1) + "%"} note={formatNumber(totalApplied) + " de " + formatNumber(totalPlanned) + " planejados"} tone="emerald" />
        <Card label="Saldo com atenção" value={formatNumber(shortage)} note="Necessidade após rateio do armazém" tone={shortage ? "amber" : "slate"} />
        <Card label="Pedidos pendentes" value={formatNumber(pendingOrders.reduce((sum, row) => sum + standardQuantity(row, "pending", productFor(row, "pending", dimensions), dimensions), 0))} note={pendingOrders.length ? String(pendingOrders.length) + " linhas de pedido" : "Importe na guia Premissas"} />
        <Card label="Vínculos de material" value={materialResolution.described ? String(materialResolution.resolved) + "/" + String(materialResolution.described) : "—"} note="Descrições conciliadas pela dimensão" tone={materialResolution.described > materialResolution.resolved ? "amber" : "slate"} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">{groupedProgress.map((group) => <div className="rounded-2xl border border-slate-200 bg-white p-5" key={group.cycle}><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Execução por subgrupo — {group.cycle}</h2><p className="mt-1 text-xs text-slate-500">Planejado x aplicado, separado por grupo e subgrupo.</p></div><BarChart3 className="h-5 w-5 text-emerald-700" /></div><div className="space-y-4">{group.rows.length ? group.rows.map((row) => <div key={row.group + "|" + row.subgroup}><div className="mb-1.5 flex items-end justify-between gap-3"><p className="text-sm font-medium">{row.subgroup} <span className="text-xs font-normal text-slate-500">{row.group}</span></p><p className="text-xs font-semibold text-slate-700">{percent(row.applied, row.planned).toFixed(1)}%</p></div><Progress value={percent(row.applied, row.planned)} /><p className="mt-1 text-xs text-slate-500">{formatNumber(row.applied)} aplicado de {formatNumber(row.planned)} planejado</p></div>) : <p className="py-8 text-center text-sm text-slate-500">Sem linhas conciliadas para este ciclo.</p>}</div></div>)}</div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4"><h2 className="font-semibold">Macro por cultura</h2><p className="mt-1 text-xs text-slate-500">Área executada registrada no ZPS007, por safra e safrinha.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{macroCrop.map((crop) => <div className="rounded-xl bg-slate-50 p-4" key={crop.code}><p className="text-xs font-semibold text-emerald-700">{crop.cycle}</p><p className="mt-1 font-semibold">{crop.name}</p><p className="mt-3 text-lg font-bold">{formatNumber(crop.applied)}</p><p className="text-xs text-slate-500">área executada registrada</p></div>)}</div></div>
      {materialResolution.described > materialResolution.resolved ? <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p><strong>Conciliação incompleta:</strong> {materialResolution.described - materialResolution.resolved} descrições não estão nas dimensões. Elas são identificadas, mas nunca viram uma chave pelo código SAP.</p></div> : null}
    </section> : <Empty title="Comece pela importação" description="Carregue Planejamento, CN52, ZMM_BATCH e MB5T. Depois envie Dimensões para conciliar materiais pelo nome." />;
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
        onQueryChange={setQuery}
        onSubgroupChange={setSubgroupFilter}
        query={query}
        subgroupFilter={subgroupFilter}
        subgroups={filters.subgroups}
      />
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1300px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>{["", "Princípio ativo", "Ciclo / cultura", "Núcleo", "Material padrão", "Material em estoque", "Qtd. planejada", "Saldo", "Trânsito", "Aplicado", "A entregar", "V. solicitado"].map((head) => <th className="px-3 py-3 font-semibold" key={head}>{head}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {executionRows.map((row) => <Fragment key={row.id}>
              <tr>
                <td className="px-3 py-3"><button aria-label="Expandir materiais" className="rounded border border-slate-200 p-1 text-slate-600" onClick={() => setExpanded(expanded === row.id ? null : row.id)} type="button"><ChevronDown className={cn("h-3.5 w-3.5", expanded === row.id && "rotate-180")} /></button></td>
                <td className="px-3 py-3 font-medium">{row.active}</td>
                <td className="px-3 py-3">{row.cycles.join(", ") || "—"}<br /><span className="text-xs text-slate-500">{row.cultures.join(", ") || "Sem cultura"}</span></td>
                <td className={cn("px-3 py-3", row.isWarehouseView && "font-semibold text-emerald-800")}>{row.nucleus}</td>
                <td className="px-3 py-3 font-medium">{row.standardMaterial}</td>
                <td className="px-3 py-3">{row.stockMaterials.join(", ") || "—"}</td>
                <td className="px-3 py-3">{formatNumber(row.planned)}</td>
                <td className="px-3 py-3">{formatNumber(row.farmBalance + row.warehouseBalance)}</td>
                <td className="px-3 py-3">{formatNumber(row.transit)}</td>
                <td className="px-3 py-3">{formatNumber(row.applied)}</td>
                <td className="px-3 py-3">{formatNumber(Math.max(0, row.planned - row.applied))}</td>
                <td className="px-3 py-3 font-semibold text-emerald-700">{formatNumber(row.pendingOrder)}</td>
              </tr>
              {expanded === row.id ? <tr><td className="bg-emerald-50 px-5 py-4 text-xs text-emerald-950" colSpan={12}><StockDetails row={row} /></td></tr> : null}
            </Fragment>)}
            {!executionRows.length ? <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={12}>Nenhum material atende aos filtros.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section> : <Empty title="Sem acompanhamento conciliado" description="Importe planejamento, consumo, estoque por lote e trânsito para ativar esta visão." />;
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card label="% do planejamento executado" value={percentageText(performanceSummary.applied, performanceSummary.planned)} note={formatNumber(performanceSummary.applied) + " executado de " + formatNumber(performanceSummary.planned) + " planejado"} tone="emerald" />
        <Card label="Volumes" value={formatNumber(performanceSummary.planned) + " / " + formatNumber(performanceSummary.applied)} note="planejado / executado" />
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
    content = <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-6 py-5"><h2 className="font-semibold">Nova importação</h2><p className="mt-1 text-xs text-slate-500">As fontes são processadas no navegador desta sessão; nenhum JSON de API é exigido.</p></div><div className="grid gap-3 p-6 md:grid-cols-2">{sourceConfig.map((source) => <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 hover:border-emerald-300" key={source.key}><input accept=".xlsx,.xls" className="sr-only" onChange={(event) => setUploads((current) => ({ ...current, [source.key]: event.target.files?.[0] }))} type="file" /><div className="flex items-center gap-3"><FileUp className="h-5 w-5 text-emerald-700" /><div><p className="text-sm font-semibold">{source.title}</p><p className="text-xs text-slate-500">{imports[source.key]?.fileName || uploads[source.key]?.name || source.hint}</p></div></div><span className="text-xs font-semibold text-emerald-700">{imports[source.key] ? "Importado" : uploads[source.key] ? "Selecionado" : "Selecionar"}</span></label>)}<DimensionUpload onLoaded={setBundle} /></div><div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-600">{message || "Cada fonte forma uma carga da sessão e alimenta os visuais imediatamente."}</p><button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60" disabled={importing} onClick={importFiles} type="button"><Upload className="mr-2 inline h-4 w-4" />{importing ? "Importando..." : "Validar e importar"}</button></div>{Object.keys(imports).length ? <div className="border-t border-slate-100 p-6"><Table headers={["Fonte", "Arquivo", "Linhas", "Abas"]} rows={sourceConfig.map((source) => [source.title, imports[source.key]?.fileName || "—", String(imports[source.key]?.rows ?? "—"), imports[source.key]?.sheets.join(", ") || "—"])} /></div> : null}</section>;
  } else if (active === "Alertas") {
    const failures = consolidatedSupply.failures;
    content = <Table headers={["Tipo", "Situação", "Detalhe"]} rows={[["Ordens excluídas", excluded ? "Atenção" : "Sem registros", String(excluded) + " linhas EXCL não compõem a execução"], ["Conciliação de materiais", materialResolution.described > materialResolution.resolved ? "Atenção" : "Regular", materialResolution.described ? String(materialResolution.resolved) + " de " + String(materialResolution.described) + " descrições resolvidas" : "Importe estoque e dimensões"], ["Ruptura de saldo", failures.length ? "Atenção" : "Sem déficit", failures.length ? String(failures.length) + " materiais com necessidade não atendida" : "Nenhuma falta calculada"], ["Provisionamento", "Disponível", "Defina a janela na Calendarização e exporte o microdetalhe."]]} />;
  } else if (active === "Tarefas") {
    content = <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-semibold">Tarefas</h2><div className="mt-5 flex gap-2"><input className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm" onChange={(event) => setTask(event.target.value)} placeholder="Descreva uma ação" value={task} /><button className="rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white" onClick={() => { if (task.trim()) { setTasks((current) => [...current, task.trim()]); setTask(""); } }} type="button">Adicionar</button></div><div className="mt-5 space-y-2">{tasks.length ? tasks.map((item) => <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm" key={item}><CheckCircle2 className="h-4 w-4 text-emerald-700" />{item}</div>) : <p className="text-sm text-slate-500">Nenhuma tarefa criada nesta sessão.</p>}</div></section>;
  } else if (active === "Usuários") {
    content = <Table headers={["Perfil", "Permissões"]} rows={[["Administrador", "Importações, premissas, usuários e regras"], ["Editor", "Tarefas, alertas e relatórios"], ["Visualizador", "Consulta e exportações autorizadas"]]} />;
  } else {
    content = <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-semibold">Configurações</h2><p className="mt-2 text-sm text-slate-500">Gerencie premissas operacionais, dimensões e pedidos pendentes.</p><button className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white" onClick={() => setShowPremises(true)} type="button"><SlidersHorizontal className="h-4 w-4" />Editar premissas</button></section>;
  }

  return <main className="min-h-screen bg-[#f7f9f7] text-slate-900" data-theme={dark ? "dark" : "light"}><Navigation active={active} onSelect={setActive} /><div className="lg:pl-[248px]"><header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-slate-200 bg-white/90 px-5 backdrop-blur lg:px-9"><div><p className="text-sm font-semibold">{active}</p><p className="text-xs text-slate-500">Safra 2026/2027</p></div><div className="flex items-center gap-2"><button aria-label="Alternar modo de cor" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700" onClick={toggleTheme} type="button">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button><button className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700" onClick={() => setShowPremises(true)} type="button"><SlidersHorizontal className="h-4 w-4" />Premissas</button></div></header><div className="mx-auto max-w-[1480px] px-5 py-8 lg:px-9"><section className="mb-7"><p className="text-xs font-bold uppercase tracking-[.15em] text-emerald-700">Centro de comando</p><h1 className="mt-2 text-3xl font-bold tracking-tight">{active}</h1><p className="mt-2 text-sm text-slate-500">{hasData ? "Dados carregados nesta sessão do navegador." : "Importe as fontes para ativar os dados operacionais."}</p></section>{content}</div></div>

    {showProvision ? <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog"><div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="font-semibold">Provisionamento micro</h2><p className="mt-1 text-xs text-slate-500">As linhas abaixo detalham fazenda, armazém e trânsito apenas do mesmo material.</p></div><div className="flex items-center gap-2"><button className="inline-flex items-center gap-2 rounded-lg border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-700" onClick={exportProvision} type="button"><Download className="h-4 w-4" />Exportar Excel</button><button aria-label="Fechar provisionamento" className="p-2 text-slate-500" onClick={() => setShowProvision(false)} type="button"><X className="h-4 w-4" /></button></div></div><div className="grid gap-4 border-b border-slate-100 p-6 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Início<input className="rounded-lg border border-slate-200 px-3 py-2" onChange={(event) => setEvaluationDate(event.target.value)} type="date" value={evaluationDate} /></label><label className="grid gap-1.5 text-sm font-medium">Fim<input className="rounded-lg border border-slate-200 px-3 py-2" onChange={(event) => setProvisionUntil(event.target.value)} type="date" value={provisionUntil} /></label></div><div className="grid gap-3 border-b border-slate-100 p-6 sm:grid-cols-4"><Card label="Demanda" value={formatNumber(provision.demand)} /><Card label="Saldo em fazenda" value={formatNumber(provision.farm)} /><Card label="Trânsito" value={formatNumber(provision.transit)} /><Card label="Apoio do armazém" value={formatNumber(provision.warehouse)} note="saldo central compartilhado" /></div><p className="px-6 py-3 text-xs text-slate-500">{provision.dated ? "A demanda foi filtrada por DT_Aplicacao do planejamento." : "Não foi encontrada data prevista reconhecida: a janela usa todas as linhas."}</p><div className="min-h-0 flex-1 overflow-auto border-t border-slate-100"><table className="w-full min-w-[1080px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr>{["Núcleo", "Princípio ativo", "Material padrão", "Demanda", "Saldo", "Trânsito", "Situação"].map((head) => <th className="px-4 py-3 font-semibold" key={head}>{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{provision.rows.map((row) => <Fragment key={row.id}><tr><td className="px-4 py-3 font-medium">{row.nucleus}</td><td className="px-4 py-3">{row.active}</td><td className="px-4 py-3 font-medium">{row.standardMaterial}</td><td className="px-4 py-3">{formatNumber(row.demand)}</td><td className="px-4 py-3">{formatNumber(row.farmBalance)}</td><td className="px-4 py-3">{formatNumber(row.transit)}</td><td className={cn("px-4 py-3 font-semibold", row.status === "Falta" ? "text-rose-700" : "text-emerald-700")}>{row.status}</td></tr>{[...row.locations.filter((location) => location.type !== "Armazém"), ...row.warehouseLocations].map((location, index) => <tr className="bg-slate-50/70 text-xs" key={row.id + "|" + location.type + "|" + location.location + "|" + String(index)}><td className="py-2 pl-8 pr-4 text-slate-500">{location.type}</td><td className="px-4 py-2 text-slate-500" colSpan={2}>{location.location}</td><td className="px-4 py-2 text-slate-500" colSpan={2}>{location.material}</td><td className="px-4 py-2 font-medium">{formatNumber(location.amount)}</td><td className="px-4 py-2 text-slate-500">{location.type === "Armazém" ? "Apoio possível" : "Saldo localizado"}</td></tr>)}</Fragment>)}{!provision.rows.length ? <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={7}>Não há demanda planejada para esta janela.</td></tr> : null}</tbody></table></div></div></div> : null}

    {showPremises ? <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="font-semibold">Premissas e dimensões</h2><p className="mt-1 text-xs text-slate-500">Regras operacionais, mapeamentos editáveis e pedidos pendentes.</p></div><button aria-label="Fechar premissas" className="p-2 text-slate-500" onClick={() => setShowPremises(false)} type="button"><X className="h-4 w-4" /></button></div><div className="grid gap-4 p-6 sm:grid-cols-2">{[["Tolerância de desvio (%)", "tolerance"], ["Amostra mínima", "sample"], ["Janelas de demanda", "horizon"], ["Status excluído", "excludedStatus"]].map(([label, key]) => <label className="grid gap-1.5 text-sm font-medium" key={key}>{label}<input className="rounded-lg border border-slate-200 px-3 py-2" onChange={(event) => setPremises({ ...premises, [key]: event.target.value })} value={premises[key as keyof Premises]} /></label>)}</div><div className="border-t border-slate-100 px-6 py-5"><h3 className="text-sm font-semibold">Pedidos pendentes</h3><p className="mt-1 text-xs text-slate-500">Use Centro, Descrição Material e Saldo Forn. O saldo fornecedor alimenta Volume solicitado.</p><label className="mt-3 flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 p-4 hover:border-emerald-500"><input accept=".xlsx,.xls" className="sr-only" onChange={(event) => void loadPending(event.target.files?.[0])} type="file" /><div className="flex items-center gap-3"><FileUp className="h-5 w-5 text-emerald-700" /><div><p className="text-sm font-semibold">Pedidos pendentes</p><p className="text-xs text-slate-500">{pendingLabel}</p></div></div><span className="text-xs font-semibold text-emerald-700">{pendingOrders.length ? "Importado" : "Selecionar"}</span></label>{pendingError ? <p className="mt-2 text-xs text-rose-700">{pendingError}</p> : null}{pendingOrders.length ? <button className="mt-2 text-xs font-semibold text-rose-700" onClick={() => { setPendingOrders([]); setPendingLabel("Pedidos pendentes (opcional)"); }} type="button">Remover pedidos importados</button> : null}</div><div className="border-t border-slate-100 px-6 py-5"><h3 className="text-sm font-semibold">Nova premissa de dimensão</h3><p className="mt-1 text-xs text-slate-500">Material: nome → material agregado. Centro/Fazenda: chave → núcleo. Conversão: material padrão|apresentação física → fator (a quantidade física é dividida).</p><div className="mt-3 grid gap-2 sm:grid-cols-4"><select className="rounded-lg border border-slate-200 px-2 py-2 text-sm" onChange={(event) => setDraft({ ...draft, domain: event.target.value })} value={draft.domain}><option>Material</option><option>Princípio ativo</option><option>Centro</option><option>Fazenda</option><option>Cultura</option><option>Conversão</option></select><input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onChange={(event) => setDraft({ ...draft, key: event.target.value })} placeholder="Chave" value={draft.key} /><input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder="Valor" value={draft.value} /><button className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700" onClick={addPremise} type="button">Incluir</button></div>{dimensionPremises.length ? <div className="mt-4 space-y-2">{dimensionPremises.map((item, index) => <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs" key={item.domain + "|" + item.key + "|" + String(index)}><span>{item.domain}: <strong>{item.key}</strong> → {item.value}</span><button className="text-rose-600" onClick={() => setDimensionPremises((current) => current.filter((_, position) => position !== index))} type="button">Remover</button></div>)}</div> : null}<p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">WBS: [Cultura].[Fazenda].[Safra].[Talhão]-[Índice]; A=1, B=2, C=3, D=4, E=5.</p></div><div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4"><button className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600" onClick={() => setShowPremises(false)} type="button">Cancelar</button><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => { setShowPremises(false); setMessage("Premissas aplicadas à conciliação desta sessão."); }} type="button">Salvar</button></div></div></div> : null}
  </main>;
}
