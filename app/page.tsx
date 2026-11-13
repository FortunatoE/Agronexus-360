"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, ArrowUpRight, Bell, Boxes, CalendarDays, ChevronDown, ClipboardCheck, FileUp, LayoutDashboard, MapPinned, PackageSearch, Settings, ShieldCheck, SlidersHorizontal, Sprout, Upload, UsersRound, X } from "lucide-react";

const navigation = [
  { label: "Visão geral", icon: LayoutDashboard, active: true },
  { label: "Calendarização", icon: CalendarDays },
  { label: "Execução", icon: ClipboardCheck },
  { label: "Volumes", icon: Boxes },
  { label: "Cobertura", icon: PackageSearch },
];

const administration = [
  { label: "Importações", icon: FileUp },
  { label: "Alertas", icon: Bell },
  { label: "Tarefas", icon: ClipboardCheck },
  { label: "Usuários", icon: UsersRound },
  { label: "Configurações", icon: Settings },
];

const metricCards = [
  { title: "Área planejada", unit: "ha", accent: "bg-emerald-600" },
  { title: "Área executada", unit: "ha", accent: "bg-teal-500" },
  { title: "Volume consumido", unit: "por unidade", accent: "bg-amber-500" },
  { title: "Risco de ruptura", unit: "materiais", accent: "bg-rose-500" },
];

const importSources = [
  { key: "planejamento", title: "Planejamento", hint: "PLANEJAMENTO.xlsx" },
  { key: "execucao", title: "Execução SAP", hint: "ZPS007.xlsx" },
  { key: "consumo", title: "Consumo SAP", hint: "CN52.xlsx" },
  { key: "estoque", title: "Estoque físico", hint: "MB52.xlsx" },
  { key: "transito", title: "Materiais em trânsito", hint: "MB5T.xlsx" },
];

type Premises = {
  tolerance: string;
  sample: string;
  horizon: string;
  excludedStatus: string;
};

type ImportedSource = {
  fileName: string;
  sheets: string[];
  rows: number;
};

const initialPremises: Premises = {
  tolerance: "5",
  sample: "3",
  horizon: "7, 15, 30",
  excludedStatus: "EXCL",
};

function SidebarGroup({ items, title }: { items: typeof navigation; title?: string }) {
  return <section className="space-y-1">
    {title ? <p className="px-3 pb-2 pt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{title}</p> : null}
    {items.map(({ label, icon: Icon, active }) => <button aria-current={active ? "page" : undefined} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${active ? "bg-emerald-50 text-emerald-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`} key={label} type="button">
      <Icon className="h-4 w-4" strokeWidth={active ? 2.5 : 2} />{label}
    </button>)}
  </section>;
}

function MetricCard({ title, unit, accent }: (typeof metricCards)[number]) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between"><p className="text-sm font-medium text-slate-600">{title}</p><span className={`h-2.5 w-2.5 rounded-full ${accent}`} /></div>
    <div className="mt-7 flex items-end justify-between"><p className="text-3xl font-semibold tracking-tight text-slate-300">—</p><span className="text-xs text-slate-400">{unit}</span></div>
    <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">Aguardando importação válida</p>
  </article>;
}

export default function Home() {
  const [uploads, setUploads] = useState<Record<string, File | undefined>>({});
  const [showPremises, setShowPremises] = useState(false);
  const [premises, setPremises] = useState<Premises>(initialPremises);
  const [premisesSaved, setPremisesSaved] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importedSources, setImportedSources] = useState<Record<string, ImportedSource>>({});

  function handleUpload(source: string, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploads((current) => ({ ...current, [source]: file }));
  }

  function savePremises() {
    window.localStorage.setItem("agronexus-premises", JSON.stringify(premises));
    setPremisesSaved(true);
  }

  async function validateSelection() {
    const required = ["planejamento", "execucao", "consumo", "estoque", "transito"];
    const missing = required.filter((source) => !uploads[source]);
    if (missing.length) {
      setValidationMessage("Selecione Planejamento, ZPS007, CN52, MB52 e MB5T para iniciar a importação.");
      return;
    }

    setIsImporting(true);
    try {
      const entries = await Promise.all(required.map(async (source) => {
        const file = uploads[source] as File;
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const rows = workbook.SheetNames.reduce((total, sheetName) => total + XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null }).length, 0);
        return [source, { fileName: file.name, sheets: workbook.SheetNames, rows }] as const;
      }));
      const parsedSources = Object.fromEntries(entries);
      setImportedSources(parsedSources);
      window.localStorage.setItem("agronexus-last-import", JSON.stringify({ importedAt: new Date().toISOString(), sources: parsedSources }));
      setValidationMessage("Importação local concluída. Os arquivos foram lidos e a estrutura foi registrada neste navegador.");
    } catch {
      setValidationMessage("Não foi possível ler um dos arquivos. Confirme se todos estão em formato Excel válido (.xlsx ou .xls).");
    } finally {
      setIsImporting(false);
    }
  }

  return <main className="min-h-screen bg-[#f7f9f7] text-slate-900">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[252px] border-r border-slate-200 bg-white px-4 py-5 lg:block">
      <div className="flex items-center gap-3 px-3 pb-8"><div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-700 text-white shadow-sm"><Sprout className="h-5 w-5" /></div><div><p className="text-sm font-bold tracking-tight text-slate-900">AgroNexus</p><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-700">Planejamento 360°</p></div></div>
      <SidebarGroup items={navigation} /><SidebarGroup items={administration} title="Gestão" />
      <div className="absolute bottom-5 left-4 right-4 rounded-2xl bg-slate-900 p-4 text-white"><ShieldCheck className="h-5 w-5 text-emerald-300" /><p className="mt-3 text-xs font-semibold">Dados sob controle</p><p className="mt-1 text-[11px] leading-relaxed text-slate-300">As importações preservam versões e impedem substituições incompletas.</p></div>
    </aside>
    <div className="lg:pl-[252px]">
      <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-slate-200 bg-white/90 px-5 backdrop-blur lg:px-9">
        <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-700 text-white lg:hidden"><Sprout className="h-5 w-5" /></div><div><p className="text-sm font-semibold">Visão geral</p><p className="text-xs text-slate-500">Safra 2026/2027</p></div></div>
        <div className="flex items-center gap-2"><button className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 sm:flex" type="button"><MapPinned className="h-4 w-4 text-emerald-700" />Todos os núcleos<ChevronDown className="h-3.5 w-3.5" /></button><button aria-label="Notificações" className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" type="button"><Bell className="h-4 w-4" /></button><div className="grid h-9 w-9 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">AF</div></div>
      </header>
      <div className="mx-auto max-w-[1480px] px-5 py-8 lg:px-9">
        <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-emerald-700">Centro de comando</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Planejamento agrícola</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">Acompanhe execução, disponibilidade e riscos quando uma versão de dados for homologada.</p></div><div className="flex flex-wrap gap-2"><button className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" onClick={() => { setPremisesSaved(false); setShowPremises(true); }} type="button"><SlidersHorizontal className="h-4 w-4" />Premissas</button><a className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800" href="#importacoes"><Upload className="h-4 w-4" />Importar dados</a></div></section>
        <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores principais">{metricCards.map((card) => <MetricCard key={card.title} {...card} />)}</section>
        <section className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="font-semibold">Execução operacional</h2><p className="mt-1 text-xs text-slate-500">Planejado versus executado por período</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">Sem dados</span></div><div className="grid min-h-[298px] place-items-center p-8 text-center"><div className="max-w-sm"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><CalendarDays className="h-6 w-6" /></div><h3 className="mt-4 font-semibold">A execução aparece após a importação</h3><p className="mt-2 text-sm leading-relaxed text-slate-500">Importe Planejamento, ZPS007 e CN52. A plataforma validará a versão antes de liberar indicadores.</p></div></div></article>
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Central de atenção</h2><p className="mt-1 text-xs text-slate-500">Alertas operacionais e de abastecimento</p></div><AlertTriangle className="h-5 w-5 text-amber-500" /></div><div className="mt-8 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5"><p className="text-sm font-medium text-slate-700">Nenhum alerta calculado</p><p className="mt-1.5 text-xs leading-relaxed text-slate-500">Alertas de ruptura, vencimento e desvio só são gerados com dados conciliados.</p></div><button className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700" type="button">Ver regras de alerta <ArrowUpRight className="h-4 w-4" /></button></article>
        </section>
        <section className="mt-7 rounded-2xl border border-slate-200 bg-white shadow-sm" id="importacoes"><div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Importações</h2><p className="mt-1 text-xs text-slate-500">Selecione os arquivos para formar uma nova versão de dados.</p></div><span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${Object.keys(importedSources).length ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}><span className={`h-1.5 w-1.5 rounded-full ${Object.keys(importedSources).length ? "bg-emerald-500" : "bg-amber-500"}`} /> {Object.keys(importedSources).length ? "Importação local concluída" : "Validação pendente"}</span></div><div className="grid gap-3 p-5 md:grid-cols-2">{importSources.map(({ key, title, hint }) => <label className="group flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 transition hover:border-emerald-300 hover:bg-emerald-50/30" key={key}><input accept=".xlsx,.xls" className="sr-only" onChange={(event) => handleUpload(key, event.target.files)} type="file" /><div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 group-hover:bg-emerald-100 group-hover:text-emerald-700"><FileUp className="h-5 w-5" /></div><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{title}</p><p className="truncate text-xs text-slate-500">{importedSources[key] ? `${importedSources[key].fileName} · ${importedSources[key].rows} linhas` : uploads[key]?.name ?? hint}</p></div></div><span className={`shrink-0 text-xs font-semibold ${importedSources[key] ? "text-emerald-700" : uploads[key] ? "text-amber-700" : "text-slate-400"}`}>{importedSources[key] ? "Importado" : uploads[key] ? "Selecionado" : "Selecionar"}</span></label>)}</div><div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-relaxed text-slate-500">{validationMessage || "Selecione as cinco fontes. A leitura ocorre localmente neste navegador e registra a estrutura de cada arquivo."}</p><button className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60" disabled={isImporting} onClick={validateSelection} type="button"><ClipboardCheck className="h-4 w-4" />{isImporting ? "Importando..." : "Validar e importar"}</button></div></section>
      </div>
    </div>
    {showPremises ? <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog"><div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="font-semibold">Premissas operacionais</h2><p className="mt-1 text-xs text-slate-500">Alterações salvas neste navegador durante a implantação inicial.</p></div><button aria-label="Fechar premissas" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={() => setShowPremises(false)} type="button"><X className="h-4 w-4" /></button></div><div className="grid gap-4 p-6 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium text-slate-700">Tolerância de desvio (%)<input className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-600" onChange={(event) => setPremises({ ...premises, tolerance: event.target.value })} value={premises.tolerance} /></label><label className="grid gap-1.5 text-sm font-medium text-slate-700">Amostra mínima para dose real<input className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-600" onChange={(event) => setPremises({ ...premises, sample: event.target.value })} value={premises.sample} /></label><label className="grid gap-1.5 text-sm font-medium text-slate-700">Janelas de demanda (dias)<input className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-600" onChange={(event) => setPremises({ ...premises, horizon: event.target.value })} value={premises.horizon} /></label><label className="grid gap-1.5 text-sm font-medium text-slate-700">Status excluído da execução<input className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-600" onChange={(event) => setPremises({ ...premises, excludedStatus: event.target.value })} value={premises.excludedStatus} /></label><div className="sm:col-span-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500"><span className="font-semibold text-slate-700">WBS validado:</span> [Cultura].[Fazenda].[Safra].[Talhão]-[Índice]. A=1, B=2, C=3, D=4, E=5.</div></div><div className="flex items-center justify-between border-t border-slate-100 px-6 py-4"><p className="text-xs font-medium text-emerald-700">{premisesSaved ? "Premissas salvas neste navegador." : ""}</p><div className="flex gap-2"><button className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100" onClick={() => setShowPremises(false)} type="button">Cancelar</button><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800" onClick={savePremises} type="button">Salvar premissas</button></div></div></div></div> : null}
  </main>;
}
