"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowRight, FileText, Plus, RefreshCw, Trash2 } from "lucide-react";

type User = { id: string; name: string; username: string; role: string; nucleus?: string };
type Unit = { code: string; nucleus: string };
type Assignee = { id: string; name: string; username: string };
type Item = { id?: string; code: string; material: string; quantity: number; unit: string; lot: string; depot?: string; expiry?: string; availableAtRequest?: number; stockKey?: string };
type StockOption = { key: string; center: string; depot: string; code: string; material: string; lot: string; unit: string; expiry: string; available: number };
type Draft = { code: string; stockKey: string; quantity: string };
type DocKind = "devolucao" | "transferencia" | "receituario";
type Transfer = {
  id: string; origin: string; destination: string; originNucleus: string; destinationNucleus: string;
  requester: string; createdBy: string; observation: string; items: Item[]; stockSource?: string; stockImportedAt?: string | null;
  stage: "fiscal" | "recipe" | "done" | "deletion_pending" | "deleted"; status: string; agronomistName?: string;
  revision: number; isMine: boolean; isOutgoing: boolean; isIncoming: boolean; isAssigned: boolean; canEdit: boolean; canRequestDeletion: boolean; canConfirmDeletion: boolean;
  deletion?: { requestedBy: string; requestedAt: string; reason: string; decision?: string; decidedBy?: string; decidedAt?: string };
  createdAt: string; canFiscal: boolean; canRecipe: boolean;
  documents: { id: string; kind: DocKind; name: string; bytes: number; actor: string; at: string }[];
  history: { actor: string; action: string; at: string }[];
};
type Data = { rows: Transfer[]; units: Unit[]; assignees: Assignee[] };
const blank = (): Draft => ({ code: "", stockKey: "", quantity: "" });
const labels: Record<DocKind, string> = { devolucao: "NF de devolução", transferencia: "NF de transferência", receituario: "Receituário" };
const stageTone = (stage: Transfer["stage"]) => stage === "deleted" ? "bg-slate-100 text-slate-600" : stage === "deletion_pending" ? "bg-rose-100 text-rose-800" : stage === "done" ? "bg-emerald-100 text-emerald-800" : stage === "recipe" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-900";
const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
function quantityInput(value: string) {
  const raw = value.trim();
  if (!/^\d+(?:[.,]\d+)*$/.test(raw)) return NaN;
  if (raw.includes(",")) return /^\d+(?:\.\d{3})*,\d+$/.test(raw) ? Number(raw.replace(/\./g, "").replace(",", ".")) : NaN;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ""));
  return /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
}
const date = (value: string) => new Date(value).toLocaleString("pt-BR");
const field = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm";
const button = "rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold disabled:opacity-50";
const primary = "rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

async function api(body?: Record<string, unknown>) {
  const response = await fetch("/api/transfers", body ? { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "include", cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Não foi possível acessar as transferências.");
  return result;
}
function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(file);
  });
}

export function FarmTransfers({ user }: { user: User }) {
  const [data, setData] = useState<Data>({ rows: [], units: [], assignees: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [create, setCreate] = useState(false);
  const [editing, setEditing] = useState<{ id: string; revision: number } | null>(null);
  const [scope, setScope] = useState(user.role === "admin" ? "all" : "mine");
  const [deletionId, setDeletionId] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const [page, setPage] = useState(1);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [requester, setRequester] = useState(user.name || user.username);
  const [observation, setObservation] = useState("");
  const [items, setItems] = useState<Draft[]>([blank()]);
  const [stock, setStock] = useState<StockOption[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState("");
  const [stockImportedAt, setStockImportedAt] = useState<string | null>(null);
  const [stockSearch, setStockSearch] = useState("");
  const [stockVersion, setStockVersion] = useState(0);
  useEffect(() => {
    setStock([]); setStockImportedAt(null); setStockError("");
    if (!create || !origin) { setStockLoading(false); return; }
    const controller = new AbortController();
    setStockLoading(true);
    fetch("/api/transfers?origin=" + encodeURIComponent(origin), { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Falha ao consultar ZMM_BATCH.");
        if (!controller.signal.aborted) { setStock(result.options || []); setStockImportedAt(result.importedAt || null); }
      })
      .catch((e) => { if (!controller.signal.aborted) setStockError(e instanceof Error ? e.message : "Falha ao consultar ZMM_BATCH."); })
      .finally(() => { if (!controller.signal.aborted) setStockLoading(false); });
    return () => controller.abort();
  }, [create, origin, stockVersion]);
  const stockByKey = new Map(stock.map((item) => [item.key, item]));
  const products = [...new Map(stock.map((item) => [item.code, item])).values()];
  const matchingProducts = products.filter((item) => !stockSearch.trim() || (item.code + " " + item.material).toLowerCase().includes(stockSearch.trim().toLowerCase()));
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState("Todos");
  const [search, setSearch] = useState("");
  const [agronomist, setAgronomist] = useState("");
  const selected = data.rows.find((row) => row.id === selectedId);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setData(await api()); } catch (e) { setError(e instanceof Error ? e.message : "Falha ao consultar."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const origins = data.units.filter((unit) => user.role === "admin" || unit.nucleus.toUpperCase() === user.nucleus?.toUpperCase());
  const scopes = user.role === "admin" ? [{ key: "all", label: "Todas as transferências" }] : [
    { key: "mine", label: "Minhas solicitações" }, { key: "out", label: "Saindo da minha unidade" }, { key: "in", label: "Chegando à minha unidade" },
    ...(data.rows.some((row) => row.isAssigned) ? [{ key: "assigned", label: "Receituários atribuídos" }] : []),
  ];
  const matchesScope = (row: Transfer) => user.role === "admin" || (scope === "mine" && row.isMine) || (scope === "out" && row.isOutgoing) || (scope === "in" && row.isIncoming) || (scope === "assigned" && row.isAssigned);
  const scopedRows = data.rows.filter(matchesScope);
  const selectedRows = scopedRows.filter((row) =>
    (status === "Todos" ? row.stage !== "deleted" : row.stage === status) &&
    (!search.trim() || [row.origin, row.destination, row.originNucleus, row.destinationNucleus, row.requester, ...row.items.flatMap((item) => [item.code, item.material, item.lot])].join(" ").toLowerCase().includes(search.trim().toLowerCase())));
  const pageCount = Math.max(1, Math.ceil(selectedRows.length / 20));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = selectedRows.slice((currentPage - 1) * 20, currentPage * 20);
  const deletionTarget = data.rows.find((row) => row.id === deletionId);
  useEffect(() => { setPage(1); }, [scope, status, search]);
  function beginCreate() {
    setEditing(null); setOrigin(""); setDestination(""); setRequester(user.name || user.username);
    setItems([blank()]); setObservation(""); setStockSearch(""); setSelectedId(""); setCreate(true);
  }
  function beginEdit(row: Transfer) {
    setEditing({ id: row.id, revision: row.revision }); setOrigin(row.origin); setDestination(row.destination);
    setRequester(row.requester); setObservation(row.observation || ""); setStockSearch("");
    setItems(row.items.map((item) => ({ code: item.code, stockKey: item.stockKey || "", quantity: number(item.quantity) })));
    setSelectedId(""); setCreate(true); setStockVersion((v) => v + 1);
  }
  function openFlow(row: Transfer) {
    setSelectedId(row.id); setCreate(false); setEditing(null); setAgronomist("");
  }
  async function execute(body: Record<string, unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api(body);
      setMessage(success);
      await refresh();
      return result;
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir a ação."); return null; }
    finally { setBusy(false); }
  }
  function updateItem(index: number, key: keyof Draft, value: string) {
    setItems((current) => current.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stockLoading || stockError || items.some((item) => !stockByKey.has(item.stockKey))) { setError("Selecione os materiais e lotes disponíveis na ZMM_BATCH da origem."); return; }
    const normalizedItems = items.map((item) => ({ stockKey: item.stockKey, quantity: quantityInput(item.quantity) }));
    if (normalizedItems.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0)) { setError("Informe quantidades positivas. Exemplo: 2.160 ou 1.692,50."); return; }
    const totals = new Map<string, number>();
    for (const item of normalizedItems) { const total = (totals.get(item.stockKey) || 0) + item.quantity; if (total - (stockByKey.get(item.stockKey)?.available || 0) > 0.000001) { setError("Quantidade total solicitada superior ao saldo físico do lote."); return; } totals.set(item.stockKey, total); }
    const result = await execute({ action: editing ? "edit" : "create", ...(editing || {}), origin, destination, requester, observation, items: normalizedItems }, editing ? "Transferência atualizada." : "Solicitação registrada na fila de Insumos.");
    if (result) { setCreate(false); setEditing(null); setSelectedId(""); setItems([blank()]); setObservation(""); setDestination(""); }
  }
  async function upload(kind: DocKind, file: File | undefined) {
    if (!selected || !file) return;
    if (file.size > 2 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf")) { setError("Selecione um PDF de até 2 MB."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await api({ action: "upload", id: selected.id, kind, name: file.name, data: await toBase64(file) });
      setMessage("Documento anexado.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha no anexo."); }
    finally { setBusy(false); }
  }
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-xl font-semibold">Transferências entre fazendas</h2><p className="mt-1 text-sm text-slate-500">Solicitação de materiais, notas fiscais e receituários em um fluxo rastreável.</p></div>
        <div className="flex gap-2"><button type="button" className={button} onClick={() => void refresh()} disabled={loading || busy}><RefreshCw className="inline h-4 w-4" /> Atualizar</button><button type="button" className={primary} disabled={!origins.length || busy} onClick={beginCreate}><Plus className="inline h-4 w-4" /> Nova transferência</button></div>
      </div>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      <div className="flex flex-wrap gap-2" aria-label="Visão das transferências">
        {scopes.map((tab) => <button key={tab.key} type="button" aria-pressed={scope === tab.key} className={scope === tab.key ? primary : button} onClick={() => { setScope(tab.key); setStatus("Todos"); setSelectedId(""); setCreate(false); }}>{tab.label}</button>)}
      </div>
      {create && <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="font-semibold">{editing ? "Editar transferência" : "Solicitação de transferência"}</h3>
        {editing && <p className="text-xs text-slate-500">Os lotes serão revalidados na última ZMM_BATCH. Se um lote antigo não estiver mais disponível, selecione outro.</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-xs font-medium">Unidade de origem<select required className={field} value={origin} onChange={(e) => { setOrigin(e.target.value); setItems([blank()]); setStockSearch(""); if (destination === e.target.value) setDestination(""); }}><option value="">Selecionar</option>{origins.map((unit) => <option key={unit.code} value={unit.code}>{unit.code} · {unit.nucleus}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-medium">Unidade de destino<select required className={field} value={destination} onChange={(e) => setDestination(e.target.value)}><option value="">Selecionar</option>{data.units.filter((unit) => unit.code !== origin).map((unit) => <option key={unit.code} value={unit.code}>{unit.code} · {unit.nucleus}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-medium">Solicitante<input required className={field} value={requester} onChange={(e) => setRequester(e.target.value)} /></label>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>Estoque da origem — ZMM_BATCH</strong><button type="button" className={button} disabled={!origin || stockLoading || busy} onClick={() => setStockVersion((v) => v + 1)}>Atualizar lotes</button></div>
          <p className="mt-1 text-xs text-slate-600">{!origin ? "Selecione a origem para consultar os materiais." : stockLoading ? "Consultando estoque por lote..." : stockError ? stockError : stock.length ? stock.length + " lotes / depósitos com saldo disponível." : "Nenhum lote com saldo físico e dados completos nesta unidade. Confira a importação ZMM_BATCH."} {stockImportedAt && "Importado em " + date(stockImportedAt)}</p>
          <p className="mt-1 text-xs text-slate-500">Saldo físico da última carga SAP, sem conversão ou reserva. Solicitações não baixam estoque.</p>
        </div>
        <label className="grid gap-1 text-xs font-medium">Buscar material pelo código ou descrição<input className={field} value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} placeholder="Ex.: 102080 ou MAGNUM" disabled={!origin || stockLoading} /></label>
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr>{["Código / material","Lote / depósito","Saldo físico","Quantidade","Unidade",""].map((name,i) => <th key={i} className="p-2">{name}</th>)}</tr></thead><tbody>{items.map((item,i) => {
          const chosen = stockByKey.get(item.stockKey);
          const productOptions = matchingProducts.some((product) => product.code === item.code) ? matchingProducts : [...products.filter((product) => product.code === item.code), ...matchingProducts];
          return <tr key={i} className="border-b border-slate-100"><td className="p-2"><select required aria-label="Código e material SAP" className={field} disabled={stockLoading || !stock.length} value={item.code} onChange={(e) => setItems((current) => current.map((line,index) => index === i ? { code: e.target.value, stockKey: "", quantity: "" } : line))}><option value="">Selecionar material</option>{productOptions.map((product) => <option key={product.code} value={product.code}>{product.code} — {product.material}</option>)}</select></td><td className="p-2"><select required aria-label="Lote e depósito" className={field} disabled={stockLoading || !item.code} value={item.stockKey} onChange={(e) => setItems((current) => current.map((line,index) => index === i ? { ...line, stockKey: e.target.value, quantity: "" } : line))}><option value="">Selecionar lote</option>{stock.filter((product) => product.code === item.code).map((product) => <option key={product.key} value={product.key}>{product.lot} · {product.depot} · {number(product.available)} {product.unit}</option>)}</select>{chosen?.expiry && <span className="block pt-1 text-xs text-slate-500">Validade: {chosen.expiry}</span>}</td><td className="whitespace-nowrap p-2 font-semibold">{chosen ? number(chosen.available) + " " + chosen.unit : "—"}</td><td className="p-2"><input required aria-label="Quantidade solicitada" inputMode="decimal" className={field} value={item.quantity} disabled={!chosen || stockLoading} onChange={(e) => updateItem(i,"quantity",e.target.value)} /></td><td className="p-2">{chosen?.unit || "—"}</td><td className="p-2"><button type="button" aria-label="Remover item" className={button} disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_,index) => index !== i))}><Trash2 className="h-4 w-4" /></button></td></tr>;
        })}</tbody></table></div>
        <button type="button" className={button} disabled={items.length >= 100 || !stock.length || stockLoading} onClick={() => setItems((current) => [...current,blank()])}>+ Adicionar material / lote</button>
        <label className="grid gap-1 text-xs font-medium">Observações<textarea className={field} rows={3} value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Embalagem, caixa fechada ou orientações da unidade" /></label>
        <div className="flex justify-end gap-2"><button type="button" className={button} onClick={() => { setCreate(false); setEditing(null); }}>Cancelar</button><button type="submit" className={primary} disabled={busy || stockLoading || !stock.length || items.some((item) => !stockByKey.has(item.stockKey))}>{editing ? "Salvar alterações" : "Enviar solicitação a Insumos"}</button></div>
      </form>}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap gap-2"><input className={field + " sm:max-w-xs"} placeholder="Buscar material, lote ou unidade" value={search} onChange={(e) => setSearch(e.target.value)} /><select className={field + " sm:max-w-xs"} value={status} onChange={(e) => setStatus(e.target.value)}><option value="Todos">Todos os status</option><option value="fiscal">Aguardando notas fiscais</option><option value="recipe">Aguardando receituário</option><option value="done">Concluídas</option><option value="deletion_pending">Aguardando confirmação de exclusão</option><option value="deleted">Excluídas (histórico)</option></select></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[730px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["Origem → destino","Solicitante","Materiais","Data","Status","Ações"].map((name,i) => <th key={i} className="px-3 py-3">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{visibleRows.map((row) => <tr key={row.id}><td className="px-3 py-3 font-semibold">{row.origin} <ArrowRight className="inline h-3 w-3" /> {row.destination}<span className="block text-xs font-normal text-slate-500">{row.originNucleus} → {row.destinationNucleus}</span></td><td className="px-3 py-3">{row.requester}</td><td className="px-3 py-3">{row.items.length}</td><td className="px-3 py-3 text-xs">{date(row.createdAt)}</td><td className="px-3 py-3"><span className={"rounded-full px-2 py-1 text-xs font-medium " + stageTone(row.stage)}>{row.status}</span></td><td className="px-3 py-3"><div className="flex flex-wrap gap-1.5">
          <button type="button" className={button} onClick={() => openFlow(row)}>{user.role === "admin" && row.stage !== "deleted" && row.stage !== "deletion_pending" ? "Executar fluxo" : "Consultar"}</button>
          {user.role === "admin" && <><button type="button" className={button} disabled={busy || !row.canEdit} title={row.canEdit ? "Editar transferência" : "Disponível antes de anexar documentos fiscais"} onClick={() => beginEdit(row)}>Editar</button><button type="button" className={button + " text-rose-700"} disabled={busy || !row.canRequestDeletion} title="Solicitar exclusão ao usuário criador" onClick={() => { setDeletionId(row.id); setDeletionReason(""); }}>Excluir</button></>}
          {row.canConfirmDeletion && <button type="button" className={button + " border-rose-300 text-rose-700"} onClick={() => openFlow(row)}>Responder exclusão</button>}
        </div></td></tr>)}{!selectedRows.length && <tr><td colSpan={6} className="p-8 text-center text-slate-500">{loading ? "Carregando..." : "Nenhuma transferência neste filtro."}</td></tr>}</tbody></table></div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{selectedRows.length} transferências · Página {currentPage} de {pageCount}</span><div className="flex gap-2"><button type="button" className={button} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><button type="button" className={button} disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Próxima</button></div></div>
      </div>
      {deletionTarget && <div role="dialog" aria-modal="true" aria-label="Solicitar exclusão" className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-xl"><h3 className="font-semibold">Solicitar exclusão: {deletionTarget.origin} → {deletionTarget.destination}</h3><p className="text-sm text-slate-600">O fluxo ficará suspenso até o usuário que criou a transferência confirmar ou recusar. Os documentos e histórico serão preservados. Não cancela movimentações no SAP.</p><label className="grid gap-1 text-sm">Motivo<textarea rows={3} className={field} value={deletionReason} onChange={(e) => setDeletionReason(e.target.value)} /></label><div className="flex justify-end gap-2"><button type="button" className={button} onClick={() => setDeletionId("")}>Voltar</button><button type="button" className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !deletionReason.trim()} onClick={async () => { const result = await execute({ action: "requestDeletion", id: deletionTarget.id, reason: deletionReason }, "Exclusão solicitada. Aguardando confirmação do criador."); if (result) setDeletionId(""); }}>Solicitar exclusão</button></div>{error && <p className="text-xs text-rose-700">{error}</p>}</div></div>}
      {selected && <div role="dialog" aria-modal="true" aria-label="Fluxo da transferência" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-3 sm:p-6"><div className="max-h-[90vh] w-full max-w-6xl space-y-5 overflow-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-lg font-semibold">Transferência {selected.origin} → {selected.destination}</h3><p className="text-xs text-slate-500">{selected.requester} · Registrada por {selected.createdBy} · {date(selected.createdAt)}</p></div><button type="button" className={button} onClick={() => setSelectedId("")}>Fechar detalhes</button></div>
        <div className="grid gap-2 sm:grid-cols-3">{(["fiscal","recipe","done"] as const).map((key,i) => <div key={key} className={"rounded-lg border p-3 text-xs font-semibold " + (key === selected.stage ? stageTone(key) : "border-slate-200 text-slate-500")}>{i+1}. {["Notas fiscais","Receituário","Concluída"][i]}</div>)}</div>
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs"><tr>{["Código","Material","Quantidade","Lote","Depósito","Saldo na solicitação"].map((name) => <th key={name} className="p-3">{name}</th>)}</tr></thead><tbody>{selected.items.map((item,i) => <tr key={item.id || i} className="border-b border-slate-100"><td className="p-3">{item.code}</td><td className="p-3">{item.material}</td><td className="p-3">{number(item.quantity)} {item.unit}</td><td className="p-3">{item.lot}</td><td className="p-3">{item.depot || "—"}</td><td className="p-3">{item.availableAtRequest === undefined ? "—" : number(item.availableAtRequest) + " " + item.unit}</td></tr>)}</tbody></table></div>
        {selected.stockSource && <p className="text-xs text-slate-500">Fonte: {selected.stockSource}{selected.stockImportedAt ? " · Importado em " + date(selected.stockImportedAt) : ""}</p>}
        {selected.deletion && (selected.stage === "deletion_pending" || selected.stage === "deleted") && <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><strong>{selected.status}</strong><p>Solicitada por {selected.deletion.requestedBy} · {date(selected.deletion.requestedAt)}</p><p>Motivo: {selected.deletion.reason}</p>{selected.canConfirmDeletion && <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void execute({ action: "rejectDeletion", id: selected.id }, "Exclusão recusada. Fluxo restaurado.")}>Recusar exclusão</button><button type="button" className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void execute({ action: "confirmDeletion", id: selected.id }, "Exclusão confirmada. Registro arquivado.")}>Confirmar exclusão</button></div>}</div>}
        {selected.observation && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm"><strong>Observação:</strong> {selected.observation}</p>}
        <div className="grid gap-3 md:grid-cols-3">{(["devolucao","transferencia","receituario"] as const).map((kind) => <div key={kind} className="space-y-2 rounded-xl border border-slate-200 p-3"><h4 className="text-sm font-semibold">{labels[kind]}</h4>{selected.documents.filter((doc) => doc.kind === kind).map((doc) => <a key={doc.id} href={"/api/transfers?document=" + encodeURIComponent(doc.id)} className="block break-all rounded-md bg-slate-50 p-2 text-xs text-emerald-800"><FileText className="inline h-4 w-4" /> {doc.name}<span className="block text-slate-500">{doc.actor} · {date(doc.at)}</span></a>)}{(kind === "receituario" ? selected.canRecipe : selected.canFiscal) && <label className="block text-xs font-medium">Anexar PDF (até 2 MB)<input type="file" accept=".pdf,application/pdf" className="mt-1 block w-full text-xs" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void upload(kind,file); }} /></label>}</div>)}</div>
        {selected.canFiscal && <div className="flex flex-wrap items-end gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3"><label className="grid min-w-[240px] flex-1 gap-1 text-xs font-medium">Responsável pelo receituário<select className={field} value={agronomist} onChange={(e) => setAgronomist(e.target.value)}><option value="">Selecionar usuário cadastrado</option>{data.assignees.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.username}</option>)}</select></label><button className={primary} type="button" disabled={busy || !agronomist || !selected.documents.some((d) => d.kind === "devolucao") || !selected.documents.some((d) => d.kind === "transferencia")} onClick={() => void execute({ action: "forward", id: selected.id, agronomistId: agronomist }, "Encaminhado ao responsável pelo receituário.")}>Encaminhar para receituário</button></div>}
        {selected.agronomistName && <p className="text-sm"><strong>Responsável pelo receituário:</strong> {selected.agronomistName}</p>}
        {selected.canRecipe && <button className={primary} type="button" disabled={busy || !selected.documents.some((d) => d.kind === "receituario")} onClick={() => void execute({ action: "complete", id: selected.id }, "Fluxo documental concluído.")}>Concluir transferência documental</button>}
        <div><h4 className="font-semibold">Histórico</h4><div className="mt-2 space-y-2">{selected.history.map((item,i) => <div key={i} className="border-l-2 border-emerald-600 pl-3 text-sm"><strong>{item.action}</strong><p className="text-xs text-slate-500">{item.actor} · {date(item.at)}</p></div>)}</div></div>
        {error && <p className="text-xs text-rose-700">{error}</p>}
      </div></div>}
      <p className="text-xs text-slate-500">A conclusão confirma o fluxo documental, não a saída física nem o recebimento no SAP. As notas e receitas permanecem disponíveis para consulta pelos envolvidos.</p>
    </section>
  );
}
