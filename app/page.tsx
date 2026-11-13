"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, Bell, Boxes, CalendarDays, CheckCircle2, ClipboardCheck, FileUp, LayoutDashboard, PackageSearch, Settings, ShieldCheck, SlidersHorizontal, Sprout, Upload, UsersRound, X } from "lucide-react";

type Row = Record<string, unknown>;
type Datasets = { planejamento: Row[]; execucao: Row[]; consumo: Row[]; estoque: Row[]; transito: Row[] };
type ImportSummary = { fileName: string; rows: number; sheets: string[] };
type Premises = { tolerance: string; sample: string; horizon: string; excludedStatus: string };

const emptyDatasets: Datasets = { planejamento: [], execucao: [], consumo: [], estoque: [], transito: [] };
const initialPremises: Premises = { tolerance: "5", sample: "3", horizon: "7, 15, 30", excludedStatus: "EXCL" };
const sourceConfig = [
  { key: "planejamento" as const, title: "Planejamento", hint: "PLANEJAMENTO.xlsx", header: 0 },
  { key: "execucao" as const, title: "Execução SAP", hint: "ZPS007.xlsx", header: 1 },
  { key: "consumo" as const, title: "Consumo SAP", hint: "CN52.xlsx", header: 3 },
  { key: "estoque" as const, title: "Estoque físico", hint: "MB52.xlsx", header: 1 },
  { key: "transito" as const, title: "Materiais em trânsito", hint: "MB5T.xlsx", header: 1 },
];
const nav = [
  ["Visão geral", LayoutDashboard], ["Calendarização", CalendarDays], ["Execução", ClipboardCheck], ["Volumes", Boxes], ["Cobertura", PackageSearch], ["Importações", FileUp], ["Alertas", Bell], ["Tarefas", ClipboardCheck], ["Usuários", UsersRound], ["Configurações", Settings],
] as const;

function numberFrom(value: unknown) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const normal = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  return Number(normal.replace(/[^0-9.-]/g, "")) || 0;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function dateFromPlan(value: unknown) {
  const [day, month, year] = String(value ?? "").split("/").map(Number);
  return day && month && year ? new Date(year, month - 1, day) : null;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function rowsFrom(workbook: XLSX.WorkBook, header: number) {
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(firstSheet, { range: header, defval: "" });
}

function Navigation({ active, onSelect }: { active: string; onSelect: (label: string) => void }) {
  return <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] border-r border-slate-200 bg-white px-4 py-5 lg:block">
    <div className="flex items-center gap-3 px-3 pb-7"><div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-700 text-white"><Sprout className="h-5 w-5" /></div><div><p className="text-sm font-bold">AgroNexus</p><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-emerald-700">Planejamento 360°</p></div></div>
    <div className="space-y-1">{nav.map(([label, Icon], index) => <button className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium ${active === label ? "bg-emerald-50 text-emerald-800" : "text-slate-600 hover:bg-slate-50"}`} key={label} onClick={() => onSelect(label)} type="button">{index === 5 ? <span className="mt-4 px-0.5 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Gestão</span> : null}<Icon className={`h-4 w-4 ${index === 5 ? "mt-4" : ""}`} />{label}</button>)}</div>
    <div className="absolute bottom-5 left-4 right-4 rounded-2xl bg-slate-900 p-4 text-white"><ShieldCheck className="h-5 w-5 text-emerald-300" /><p className="mt-3 text-xs font-semibold">Importações versionadas</p><p className="mt-1 text-[11px] leading-relaxed text-slate-300">A versão central será ativada com o banco de dados.</p></div>
  </aside>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="grid min-h-[280px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Sprout className="h-6 w-6" /></div><h2 className="mt-4 font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">{text}</p></div></div>;
}

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{headers.map((header) => <th className="px-5 py-3 font-semibold" key={header}>{header}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row, index) => <tr className="text-slate-700" key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td className="px-5 py-3" key={cellIndex}>{cell || "—"}</td>)}</tr>)}</tbody></table></div>;
}

export default function Home() {
  const [active, setActive] = useState("Visão geral");
  const [uploads, setUploads] = useState<Record<string, File | undefined>>({});
  const [datasets, setDatasets] = useState<Datasets>(emptyDatasets);
  const [imports, setImports] = useState<Record<string, ImportSummary>>({});
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [showPremises, setShowPremises] = useState(false);
  const [premises, setPremises] = useState<Premises>(initialPremises);
  const [tasks, setTasks] = useState<string[]>([]);
  const [taskText, setTaskText] = useState("");
  const [evaluationDate, setEvaluationDate] = useState(() => new Date().toISOString().slice(0, 10));

  const metrics = useMemo(() => {
    const plannedItems = datasets.planejamento.filter((row) => String(row["Classificacão"]).trim().toUpperCase() === "PRODUTO");
    const plantingActivities = datasets.planejamento.filter((row) => String(row["Classificacão"]).trim().toUpperCase() === "ATIVIDADE" && String(row.Atividade).trim().toUpperCase() === "PLANTIO SEM ADUBO");
    const plannedArea = plantingActivities.reduce((total, row) => total + numberFrom(row["Área executar (HA)"]), 0);
    const validExecution = datasets.execucao.filter((row) => String(row.Status).trim() !== premises.excludedStatus && String(row.UM).toUpperCase() === "HA");
    const executedArea = validExecution.reduce((total, row) => total + numberFrom(row["Área Executada"]), 0);
    const excluded = datasets.execucao.filter((row) => String(row.Status).trim() === premises.excludedStatus).length;
    const materials = new Set(datasets.consumo.map((row) => String(row.Material)).filter(Boolean)).size;
    return { plannedItems, plantingActivities, plannedArea, validExecution, executedArea, excluded, materials };
  }, [datasets, premises.excludedStatus]);

  const calendar = useMemo(() => {
    const selected = new Date(`${evaluationDate}T12:00:00`);
    const year = selected.getFullYear();
    const month = selected.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const events = new Map<string, Row[]>();
    metrics.plannedItems.forEach((row) => {
      const date = dateFromPlan(row.DT_Aplicacao);
      if (!date) return;
      const key = dateKey(date);
      events.set(key, [...(events.get(key) ?? []), row]);
    });
    const days = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start); date.setDate(start.getDate() + index);
      return { date, events: events.get(dateKey(date)) ?? [] };
    });
    const from = new Date(selected); const until = new Date(selected); until.setDate(until.getDate() + 30);
    const next = [...events.entries()].flatMap(([key, rows]) => {
      const date = new Date(`${key}T12:00:00`);
      return date >= from && date <= until ? rows.map((row) => ({ date, row })) : [];
    }).sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 12);
    return { selected, days, next, monthLabel: selected.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) };
  }, [evaluationDate, metrics.plannedItems]);

  const volumeRows = useMemo(() => {
    const grouped = new Map<string, { name: string; unit: string; consumed: number }>();
    datasets.consumo.forEach((row) => {
      const material = String(row.Material || "Sem material");
      const current = grouped.get(material) ?? { name: String(row["Texto material"] || material), unit: String(row.UMB || row.UM || ""), consumed: 0 };
      current.consumed += numberFrom(row["Qtd.retirada"]);
      grouped.set(material, current);
    });
    return [...grouped.entries()].sort((a, b) => b[1].consumed - a[1].consumed).slice(0, 12);
  }, [datasets.consumo]);

  function selectFile(source: string, files: FileList | null) {
    const file = files?.[0];
    if (file) setUploads((current) => ({ ...current, [source]: file }));
  }

  async function importFiles() {
    const missing = sourceConfig.filter(({ key }) => !uploads[key]);
    if (missing.length) { setMessage("Selecione as cinco fontes: Planejamento, ZPS007, CN52, MB52 e MB5T."); return; }
    setImporting(true);
    try {
      const results = await Promise.all(sourceConfig.map(async ({ key, header }) => {
        const file = uploads[key] as File;
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const rows = rowsFrom(workbook, header);
        return [key, { rows, summary: { fileName: file.name, rows: rows.length, sheets: workbook.SheetNames } }] as const;
      }));
      const nextData = { ...emptyDatasets };
      const nextImports: Record<string, ImportSummary> = {};
      results.forEach(([key, value]) => { nextData[key] = value.rows; nextImports[key] = value.summary; });
      setDatasets(nextData);
      setImports(nextImports);
      setMessage("Importação local concluída. Os módulos abaixo já estão usando os dados lidos nesta sessão.");
      setActive("Visão geral");
    } catch {
      setMessage("Não foi possível ler um dos arquivos. Confirme o formato Excel e os cabeçalhos esperados.");
    } finally { setImporting(false); }
  }

  function savePremises() { window.localStorage.setItem("agronexus-premises", JSON.stringify(premises)); setShowPremises(false); }
  function createTask() { if (!taskText.trim()) return; setTasks((current) => [...current, taskText.trim()]); setTaskText(""); }

  let content: React.ReactNode;
  if (active === "Visão geral") {
    content = <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Área planejada", formatNumber(metrics.plannedArea), "ha · Plantio sem adubo"], ["Área registrada", formatNumber(metrics.executedArea), "ha em ordens válidas"], ["Materiais CN52", metrics.materials, "materiais com consumo"], ["EXCL removidos", metrics.excluded, "registros fora da execução"]].map(([title, value, detail]) => <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={String(title)}><p className="text-sm font-medium text-slate-600">{title}</p><p className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">{value}</p><p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">{detail}</p></article>)}</section><section className="mt-7 grid gap-6 xl:grid-cols-[1fr_360px]"><article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-semibold">Importação da sessão</h2><p className="mt-1 text-xs text-slate-500">Fontes atualmente alimentando os visuais</p>{Object.keys(imports).length ? <DataTable headers={["Fonte", "Arquivo", "Linhas", "Abas"]} rows={sourceConfig.map(({ key, title }) => [title, imports[key]?.fileName ?? "—", String(imports[key]?.rows ?? "—"), imports[key]?.sheets.join(", ") ?? "—"])} /> : <EmptyState title="Aguardando importação" text="Abra Importações e selecione os cinco arquivos Excel para alimentar os módulos." />}</article><article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-semibold">Próximas ações</h2><div className="mt-5 space-y-3">{["Revisar calendarização", "Conferir execução válida", "Verificar principais consumos"].map((action) => <button className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:border-emerald-300" key={action} onClick={() => setActive(action.includes("calendar") ? "Calendarização" : action.includes("execução") ? "Execução" : "Volumes")} type="button">{action}<span className="text-emerald-700">→</span></button>)}</div></article></section></>;
  } else if (active === "Calendarização") {
    content = metrics.plannedItems.length ? <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]"><article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"><div><h2 className="font-semibold capitalize">{calendar.monthLabel}</h2><p className="mt-1 text-xs text-slate-500">Calendário de aplicações previstas</p></div><label className="text-xs font-semibold text-slate-600">Data de avaliação<input className="ml-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal" onChange={(event) => setEvaluationDate(event.target.value)} type="date" value={evaluationDate} /></label></div><div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => <div className="py-2" key={day}>{day}</div>)}</div><div className="grid grid-cols-7 gap-1">{calendar.days.map(({ date, events }) => { const selected = dateKey(date) === evaluationDate; const currentMonth = date.getMonth() === calendar.selected.getMonth(); return <button className={`min-h-[84px] rounded-xl border p-2 text-left transition ${selected ? "border-emerald-600 bg-emerald-50" : currentMonth ? "border-slate-100 bg-white hover:border-emerald-200" : "border-transparent bg-slate-50 text-slate-300"}`} key={date.toISOString()} onClick={() => setEvaluationDate(dateKey(date))} type="button"><p className="text-xs font-semibold">{date.getDate()}</p>{events.slice(0, 2).map((event, index) => <p className="mt-1 truncate rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800" key={index}>{String(event.Produto || event.Atividade || "Evento")}</p>)}{events.length > 2 ? <p className="mt-1 text-[10px] text-emerald-700">+{events.length - 2} eventos</p> : null}</button>; })}</div></article><aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold">Próximas pendências</h2><p className="mt-1 text-xs text-slate-500">Janela de 30 dias a partir da avaliação</p><div className="mt-5 space-y-3">{calendar.next.length ? calendar.next.map(({ date, row }, index) => <div className="rounded-xl border border-slate-100 p-3" key={`${date}-${index}`}><p className="text-xs font-bold text-emerald-700">{date.toLocaleDateString("pt-BR")}</p><p className="mt-1 text-sm font-semibold text-slate-800">{String(row.Produto || row.Atividade || "Evento planejado")}</p><p className="mt-1 text-xs text-slate-500">{String(row.Fazenda || "")} · {String(row.Talhao || "")}</p></div>) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Não há eventos planejados na janela selecionada.</p>}</div></aside></section> : <EmptyState title="Sem eventos planejados" text="Importe o arquivo de planejamento para visualizar aplicações por data." />;
  } else if (active === "Execução") {
    const rows = metrics.validExecution.slice(0, 20).map((row) => [String(row.Ordem || ""), String(row.Fazenda || ""), String(row.Talhão || ""), String(row["Data Exec. OS"] || ""), String(row.Status || ""), String(row["Área Executada"] || ""), String(row.UM || "")]);
    content = rows.length ? <DataTable headers={["Ordem", "Fazenda", "Talhão", "Início", "Status", "Executado", "UM"]} rows={rows} /> : <EmptyState title="Sem execução válida" text="A ZPS007 será exibida aqui após remover registros EXCL." />;
  } else if (active === "Volumes") {
    content = volumeRows.length ? <DataTable headers={["Material", "Descrição", "Consumo apontado", "UM"]} rows={volumeRows.map(([material, value]) => [material, value.name, formatNumber(value.consumed), value.unit])} /> : <EmptyState title="Sem consumo importado" text="Importe CN52 para acompanhar os materiais e volumes apontados." />;
  } else if (active === "Cobertura") {
    const rows = datasets.estoque.slice(0, 20).map((row) => [String(row.Material || ""), String(row["Texto breve material"] || ""), String(row["Utilização livre"] || ""), String(row.UMB || ""), String(row["Cen."] || "")]);
    content = rows.length ? <DataTable headers={["Material", "Descrição", "Estoque livre", "UM", "Centro"]} rows={rows} /> : <EmptyState title="Sem estoque importado" text="Importe MB52 e MB5T para iniciar a análise de cobertura." />;
  } else if (active === "Importações") {
    content = <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-6 py-5"><h2 className="font-semibold">Nova importação</h2><p className="mt-1 text-xs text-slate-500">Selecione todas as fontes antes de validar e importar.</p></div><div className="grid gap-3 p-6 md:grid-cols-2">{sourceConfig.map(({ key, title, hint }) => <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 hover:border-emerald-300" key={key}><input accept=".xlsx,.xls" className="sr-only" onChange={(event) => selectFile(key, event.target.files)} type="file" /><div className="flex items-center gap-3"><FileUp className="h-5 w-5 text-emerald-700" /><div><p className="text-sm font-semibold">{title}</p><p className="text-xs text-slate-500">{imports[key]?.fileName ?? uploads[key]?.name ?? hint}</p></div></div><span className="text-xs font-semibold text-emerald-700">{imports[key] ? "Importado" : uploads[key] ? "Selecionado" : "Selecionar"}</span></label>)}</div><div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-600">{message || "Os dados são processados nesta sessão e alimentam os módulos acima."}</p><button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60" disabled={importing} onClick={importFiles} type="button"><Upload className="mr-2 inline h-4 w-4" />{importing ? "Importando..." : "Validar e importar"}</button></div></section>;
  } else if (active === "Alertas") {
    content = <DataTable headers={["Tipo", "Situação", "Detalhe"]} rows={[["Ordens excluídas", metrics.excluded ? "Atenção" : "Sem registros", `${metrics.excluded} linhas EXCL não compõem execução válida`], ["Conciliação", "Pendente", "Risco e desvios dependem de conciliação WBS/PEP"], ["Ruptura", "Pendente", "Requer estoque, trânsito e demanda homologados"]]} />;
  } else if (active === "Tarefas") {
    content = <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-semibold">Tarefas</h2><div className="mt-5 flex gap-2"><input className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm" onChange={(event) => setTaskText(event.target.value)} placeholder="Descreva uma ação" value={taskText} /><button className="rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white" onClick={createTask} type="button">Adicionar</button></div><div className="mt-5 space-y-2">{tasks.length ? tasks.map((task) => <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm" key={task}><CheckCircle2 className="h-4 w-4 text-emerald-700" />{task}</div>) : <p className="text-sm text-slate-500">Nenhuma tarefa criada nesta sessão.</p>}</div></section>;
  } else if (active === "Usuários") {
    content = <DataTable headers={["Perfil", "Permissões"]} rows={[["Administrador", "Importações, parâmetros, usuários e regras"], ["Editor", "Tarefas, observações, alertas e relatórios"], ["Visualizador", "Consulta e exportações autorizadas"]]} />;
  } else {
    content = <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-semibold">Configurações</h2><p className="mt-2 text-sm text-slate-500">Gerencie as premissas operacionais da sessão atual.</p><button className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white" onClick={() => setShowPremises(true)} type="button"><SlidersHorizontal className="h-4 w-4" />Editar premissas</button></section>;
  }

  return <main className="min-h-screen bg-[#f7f9f7] text-slate-900"><Navigation active={active} onSelect={setActive} /><div className="lg:pl-[248px]"><header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-slate-200 bg-white/90 px-5 backdrop-blur lg:px-9"><div><p className="text-sm font-semibold">{active}</p><p className="text-xs text-slate-500">Safra 2026/2027</p></div><button className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700" onClick={() => setShowPremises(true)} type="button"><SlidersHorizontal className="h-4 w-4" />Premissas</button></header><div className="mx-auto max-w-[1480px] px-5 py-8 lg:px-9"><section className="mb-7"><p className="text-xs font-bold uppercase tracking-[.15em] text-emerald-700">Centro de comando</p><h1 className="mt-2 text-3xl font-bold tracking-tight">{active}</h1><p className="mt-2 text-sm text-slate-500">{Object.keys(imports).length ? "Dados carregados nesta sessão do navegador." : "Importe as fontes para ativar os dados operacionais."}</p></section>{content}</div></div>{showPremises ? <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog"><div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="font-semibold">Premissas operacionais</h2><p className="mt-1 text-xs text-slate-500">Aplicadas a esta sessão.</p></div><button className="p-2 text-slate-500" onClick={() => setShowPremises(false)} type="button"><X className="h-4 w-4" /></button></div><div className="grid gap-4 p-6 sm:grid-cols-2">{[["Tolerância de desvio (%)", "tolerance"], ["Amostra mínima", "sample"], ["Janelas de demanda", "horizon"], ["Status excluído", "excludedStatus"]].map(([label, key]) => <label className="grid gap-1.5 text-sm font-medium" key={key}>{label}<input className="rounded-lg border border-slate-200 px-3 py-2" onChange={(event) => setPremises({ ...premises, [key]: event.target.value })} value={premises[key as keyof Premises]} /></label>)}<p className="sm:col-span-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">WBS: [Cultura].[Fazenda].[Safra].[Talhão]-[Índice]; A=1, B=2, C=3, D=4, E=5.</p></div><div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4"><button className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600" onClick={() => setShowPremises(false)} type="button">Cancelar</button><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" onClick={savePremises} type="button">Salvar</button></div></div></div> : null}</main>;
}
