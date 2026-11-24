"use client";

import { clsx as cn } from "clsx";
import { useMemo, useState } from "react";

export type CommercialDeliveryStatus =
  | "Atrasado"
  | "Entregue"
  | "No prazo"
  | "Previsto"
  | "Sem pedido";

export type CommercialDeliveryTrackingRow = {
  active: string;
  calendarGap: number | null;
  closed: number;
  cycle: string;
  expectedToDate: number;
  group: string;
  id: string;
  nextScheduledMonth: string;
  orderNumber: string;
  pending: number | null;
  physicalProduct: string;
  product: string;
  received: number | null;
  status: CommercialDeliveryStatus;
  subgroup: string;
  supplier: string;
  unit: string;
};

const numberFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 4,
});

const statusOrder: Record<CommercialDeliveryStatus, number> = {
  Atrasado: 0,
  "Sem pedido": 1,
  "No prazo": 2,
  Previsto: 3,
  Entregue: 4,
};

const statusTone: Record<CommercialDeliveryStatus, string> = {
  Atrasado: "border-rose-200 bg-rose-50 text-rose-800",
  Entregue: "border-emerald-200 bg-emerald-50 text-emerald-800",
  "No prazo": "border-sky-200 bg-sky-50 text-sky-800",
  Previsto: "border-amber-200 bg-amber-50 text-amber-800",
  "Sem pedido": "border-slate-200 bg-slate-50 text-slate-700",
};

function monthLabel(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return "Sem mês definido";
  return new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  })
    .format(new Date(`${month}-01T00:00:00Z`))
    .replace(".", "");
}

function sumByUnit(
  rows: CommercialDeliveryTrackingRow[],
  value: keyof Pick<CommercialDeliveryTrackingRow, "closed" | "expectedToDate" | "pending" | "received">,
) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const amount = row[value];
    if (typeof amount !== "number" || !Number.isFinite(amount)) return;
    const unit = row.unit || "s/un.";
    totals.set(unit, (totals.get(unit) || 0) + amount);
  });
  return [...totals.entries()].sort(([left], [right]) =>
    left.localeCompare(right, "pt-BR"),
  );
}

function UnitTotals({ values }: { values: [string, number][] }) {
  if (!values.length) return <span className="text-slate-400">—</span>;
  return (
    <>
      {values.map(([unit, amount]) => (
        <span className="block leading-5" key={unit}>
          {numberFormat.format(amount)} <span className="text-[10px] font-semibold">{unit}</span>
        </span>
      ))}
    </>
  );
}

function Quantity({ value, unit }: { value: number | null; unit: string }) {
  if (value === null) return <span className="text-slate-400">A confirmar</span>;
  return (
    <>
      {numberFormat.format(value)} <span className="text-[10px] font-semibold">{unit || "s/un."}</span>
    </>
  );
}

function StatusPill({ status }: { status: CommercialDeliveryStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold",
        statusTone[status],
      )}
    >
      {status}
    </span>
  );
}

export function CommercialDeliveryTracker({
  currentMonth,
  rows,
}: {
  currentMonth: string;
  rows: CommercialDeliveryTrackingRow[];
}) {
  const [statusFilter, setStatusFilter] = useState<CommercialDeliveryStatus | "Todos">(
    "Todos",
  );
  const visibleRows = useMemo(
    () =>
      rows
        .filter((row) => statusFilter === "Todos" || row.status === statusFilter)
        .sort(
          (left, right) =>
            statusOrder[left.status] - statusOrder[right.status] ||
            left.nextScheduledMonth.localeCompare(right.nextScheduledMonth) ||
            left.product.localeCompare(right.product, "pt-BR"),
        ),
    [rows, statusFilter],
  );
  const summary = useMemo(
    () => ({
      closed: sumByUnit(visibleRows, "closed"),
      expected: sumByUnit(visibleRows, "expectedToDate"),
      pending: sumByUnit(visibleRows, "pending"),
      received: sumByUnit(visibleRows, "received"),
      lateRows: visibleRows.filter((row) => row.status === "Atrasado").length,
      linkedRows: visibleRows.filter((row) => row.status !== "Sem pedido").length,
    }),
    [visibleRows],
  );
  const filters: Array<CommercialDeliveryStatus | "Todos"> = [
    "Todos",
    "Atrasado",
    "No prazo",
    "Previsto",
    "Entregue",
    "Sem pedido",
  ];

  return (
    <section className="space-y-4" aria-labelledby="delivery-tracker-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950" id="delivery-tracker-title">
            Acompanhamento de entregas
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Saldo a chegar por pedido de compra e aderência acumulada ao calendário até {monthLabel(currentMonth)}.
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
          {summary.linkedRows} distribuição(ões) com pedido vinculado
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold text-emerald-900">Fechado</p>
          <div className="mt-2 text-lg font-bold text-emerald-950"><UnitTotals values={summary.closed} /></div>
          <p className="mt-1 text-xs text-emerald-800">volume comercial distribuído</p>
        </article>
        <article className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <p className="text-xs font-semibold text-sky-900">Fornecido</p>
          <div className="mt-2 text-lg font-bold text-sky-950"><UnitTotals values={summary.received} /></div>
          <p className="mt-1 text-xs text-sky-800">quantidade já fornecida no pedido</p>
        </article>
        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-900">Falta chegar</p>
          <div className="mt-2 text-lg font-bold text-amber-950"><UnitTotals values={summary.pending} /></div>
          <p className="mt-1 text-xs text-amber-800">Saldo Forn proporcional à distribuição</p>
        </article>
        <article className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs font-semibold text-rose-900">Calendário em atenção</p>
          <p className="mt-2 text-2xl font-bold text-rose-950">{summary.lateRows}</p>
          <p className="mt-1 text-xs text-rose-800">linha(s) abaixo do volume previsto até {monthLabel(currentMonth)}</p>
        </article>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <span className="font-bold">Leitura acumulada:</span> o arquivo de pedidos informa quantidade fornecida e saldo pendente, mas não registra a data individual de cada recebimento. Por isso, a situação compara o fornecido atual com o calendário previsto até {monthLabel(currentMonth)}.
      </div>

      <div aria-label="Filtro de situação das entregas" className="flex flex-wrap gap-2" role="group">
        {filters.map((status) => (
          <button
            aria-pressed={statusFilter === status}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-bold transition",
              statusFilter === status
                ? "border-emerald-700 bg-emerald-700 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-800",
            )}
            key={status}
            onClick={() => setStatusFilter(status)}
            type="button"
          >
            {status}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1170px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Grupo / produto</th>
              <th className="px-4 py-3">Pedido / fornecedor</th>
              <th className="px-4 py-3 text-right">Fechado</th>
              <th className="px-4 py-3 text-right">Fornecido</th>
              <th className="px-4 py-3 text-right">Falta chegar</th>
              <th className="px-4 py-3 text-right">Previsto até {monthLabel(currentMonth)}</th>
              <th className="px-4 py-3 text-right">Saldo calendário</th>
              <th className="px-4 py-3">Próxima janela</th>
              <th className="px-4 py-3">Situação</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr className="border-t border-slate-100 align-top" key={row.id}>
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-950">{row.product}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[row.group, row.subgroup, row.active].filter(Boolean).join(" · ")}
                  </p>
                  {row.physicalProduct !== row.product ? (
                    <p className="mt-1 text-xs text-emerald-700">Físico: {row.physicalProduct}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-800">{row.orderNumber || "Pedido não vinculado"}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{row.supplier || "Fornecedor não informado"}</p>
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-900"><Quantity unit={row.unit} value={row.closed} /></td>
                <td className="px-4 py-3 text-right font-medium text-sky-800"><Quantity unit={row.unit} value={row.received} /></td>
                <td className="px-4 py-3 text-right font-semibold text-amber-800"><Quantity unit={row.unit} value={row.pending} /></td>
                <td className="px-4 py-3 text-right"><Quantity unit={row.unit} value={row.expectedToDate} /></td>
                <td className={cn("px-4 py-3 text-right font-semibold", row.calendarGap !== null && row.calendarGap > 0 ? "text-rose-700" : "text-emerald-700")}>
                  {row.calendarGap === null ? "A confirmar" : row.calendarGap > 0 ? `-${numberFormat.format(row.calendarGap)} ${row.unit || ""}` : "Coberto"}
                </td>
                <td className="px-4 py-3 text-slate-700">{monthLabel(row.nextScheduledMonth)}</td>
                <td className="px-4 py-3"><StatusPill status={row.status} /></td>
              </tr>
            ))}
            {!visibleRows.length ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-slate-500" colSpan={9}>
                  Nenhuma distribuição encontrada para os filtros atuais.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
