"use client";

import { clsx as cn } from "clsx";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { commercialFarmDeliveries } from "@/lib/commercial-closings";

type Closing = Parameters<typeof commercialFarmDeliveries>[0] & {
  id: string;
  product: string;
  active: string;
  destination: string;
  deliveryLocation: string;
  culture: string;
  cycle: string;
  unit: string;
  distribution: Record<string, number>;
};

type SupplierGroup = { key: string; name: string; closings: Closing[] };
export type ClosingCalendarPeriod = { start: string; end: string };
type VolumeByUnit = Map<string, number>;

const monthNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const volumeFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const identityColumn = "sticky left-0 z-10 w-40 min-w-40 max-w-40 border-r border-slate-200 bg-inherit px-2.5 py-2 text-left sm:w-56 sm:min-w-56 sm:max-w-56";
const volumeColumn = "min-w-19 whitespace-nowrap border-l border-slate-100 px-2 py-2 text-right";

function formatCalendarMonth(month: string) {
  return `${monthNames[Number(month.slice(5)) - 1]}/${month.slice(2, 4)}`;
}

function seasonPeriod(monthKey: string): ClosingCalendarPeriod {
  const [year, month] = monthKey.split("-").map(Number);
  const startYear = year - (month < 4 ? 1 : 0);
  return { start: `${startYear}-04`, end: `${startYear + 1}-08` };
}

function defaultPeriod(registeredMonths: string[]): ClosingCalendarPeriod {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let period = seasonPeriod(registeredMonths[0] ?? currentMonth);
  // A safra seguinte só toma o lugar da anterior após o fim do período em tela.
  for (const month of registeredMonths) {
    if (currentMonth <= period.end) break;
    if (month > period.end) period = seasonPeriod(month);
  }
  return period;
}

function monthsInPeriod({ start, end }: ClosingCalendarPeriod) {
  const cursor = new Date(`${start}-01T00:00:00Z`);
  const last = new Date(`${end}-01T00:00:00Z`);
  const months: string[] = [];
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function calendarFarmRows(closing: Closing, months: string[]) {
  const byFarm = new Map<string, Record<string, number>>();
  const visibleMonths = new Set(months);
  for (const { farm, month, volume } of commercialFarmDeliveries(closing)) {
    if (!visibleMonths.has(month) || !volume) continue;
    const monthly = byFarm.get(farm) || {};
    monthly[month] = (monthly[month] ?? 0) + volume;
    byFarm.set(farm, monthly);
  }
  return [...byFarm].sort(([left], [right]) => left.localeCompare(right, "pt-BR"))
    .map(([farm, monthly]) => {
      const volumes = months.map((month) => monthly[month] ?? 0);
      return { farm, volumes: [...volumes, volumes.reduce((sum, amount) => sum + amount, 0)] };
    });
}

function summarizeCalendar(groups: SupplierGroup[], months: string[]) {
  const totalByColumn = Array.from({ length: months.length + 1 }, () => new Map<string, number>());
  const activeGroups = groups.flatMap((group) => {
    const subtotalByColumn = Array.from({ length: months.length + 1 }, () => new Map<string, number>());
    const rows = group.closings.flatMap((closing) => {
      const monthly = months.map((month) => closing.distribution[month] ?? 0);
      if (!monthly.some(Boolean)) return [];
      const unit = closing.unit?.trim().toUpperCase() || "";
      const volumes = [...monthly, monthly.reduce((sum, amount) => sum + amount, 0)];
      volumes.forEach((amount, index) => {
        if (!amount) return;
        const subtotal = subtotalByColumn[index];
        const total = totalByColumn[index];
        subtotal.set(unit, (subtotal.get(unit) ?? 0) + amount);
        total.set(unit, (total.get(unit) ?? 0) + amount);
      });
      return [{ closing, unit, volumes, farms: calendarFarmRows(closing, months) }];
    });
    return rows.length ? [{ key: group.key, name: group.name, rows, subtotalByColumn }] : [];
  });
  return { activeGroups, totalByColumn };
}

function TotalsCells({ totals }: { totals: VolumeByUnit[] }) {
  return totals.map((volumes, index) => (
    <td className={cn(volumeColumn, index === totals.length - 1 && "border-l-slate-200")} key={index}>
      {volumes.size ? [...volumes].sort(([left], [right]) => left.localeCompare(right, "pt-BR")).map(([unit, volume]) => (
        <div className="leading-4" key={unit}>{volumeFormat.format(volume)} <span className="text-[10px] font-medium">{unit || "s/un."}</span></div>
      )) : <span className="font-normal text-slate-400">—</span>}
    </td>
  ));
}

function DeliveryCells({ volumes, unit, highlight }: { volumes: number[]; unit: string; highlight?: boolean }) {
  return volumes.map((amount, index) => (
    <td className={cn(volumeColumn, amount && highlight && "bg-emerald-50 font-semibold text-emerald-900", index === volumes.length - 1 && "border-l-slate-200")} key={index}>
      {amount ? <>{volumeFormat.format(amount)} <span className="text-[10px] font-medium">{unit || "s/un."}</span></> : <span className="text-slate-400">—</span>}
    </td>
  ));
}

export function CommercialClosingCalendar({
  groups,
  onPeriodChange,
  period,
  registeredMonths,
  supplier,
}: {
  groups: SupplierGroup[];
  onPeriodChange: (period: ClosingCalendarPeriod) => void;
  period?: ClosingCalendarPeriod;
  registeredMonths: string[];
  supplier?: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});
  const suggested = defaultPeriod(registeredMonths);
  const { start, end } = period ?? suggested;
  const endpoints = [registeredMonths[0] ?? suggested.start, suggested.start, start, end, suggested.end, registeredMonths.at(-1) ?? suggested.end].sort();
  const min = endpoints[0];
  const max = endpoints[endpoints.length - 1];
  const monthOptions = monthsInPeriod({ start: min, end: max });
  const { months, activeGroups, totalByColumn } = useMemo(() => {
    const months = monthsInPeriod({ start, end });
    return { months, ...summarizeCalendar(groups, months) };
  }, [groups, start, end]);

  function updatePeriod(field: keyof ClosingCalendarPeriod, value: string) {
    onPeriodChange(field === "start"
      ? { start: value, end: value > end ? value : end }
      : { start: value < start ? value : start, end: value });
  }

  return (
    <section aria-labelledby="closing-calendar-title" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-base font-bold" id="closing-calendar-title">
          {supplier ? `Calendário de ${supplier}` : "Calendário geral de entregas"}
        </h3>
        <div aria-label="Período da safra" className="flex flex-wrap gap-2" role="group">
          {([["start", "De", start], ["end", "Até", end]] as const).map(([field, label, value]) => (
            <label className="grid gap-1 text-xs font-semibold text-slate-600" key={field}>
              {label}
              <select className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal" onChange={(event) => updatePeriod(field, event.target.value)} value={value}>
                {monthOptions.map((month) => <option key={month} value={month}>{formatCalendarMonth(month)}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>
      <div aria-label="Tabela de volumes mensais" className="max-h-[65vh] overflow-auto rounded-xl border border-slate-200 focus-visible:outline-2 focus-visible:outline-emerald-700" role="region" tabIndex={0}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20 bg-slate-50 text-slate-700">
            <tr className="bg-slate-50">
              <th className={identityColumn} scope="col">Fornecedor / produto / fazenda</th>
              {months.map((month) => (
                <th className={volumeColumn} key={month} scope="col">{formatCalendarMonth(month)}</th>
              ))}
              <th className={cn(volumeColumn, "border-l-slate-200")} scope="col">Total do período</th>
            </tr>
            {!supplier && activeGroups.length ? (
              <tr className="bg-emerald-50 font-bold text-emerald-900">
                <th className={identityColumn} scope="row">Total geral</th>
                <TotalsCells totals={totalByColumn} />
              </tr>
            ) : null}
          </thead>
          {activeGroups.map((group) => {
            const open = expanded[group.key] ?? Boolean(supplier);
            return (
              <tbody className="bg-white" key={group.key}>
                <tr className="bg-slate-50 font-semibold text-slate-900 [&>td]:border-t [&>th]:border-t">
                  <th className={identityColumn} scope="rowgroup">
                    <button
                      aria-expanded={open}
                      className="flex w-full items-start gap-1 text-left hover:underline"
                      onClick={() => setExpanded((current) => ({ ...current, [group.key]: !open }))}
                      type="button"
                    >
                      {open ? <ChevronDown aria-hidden="true" className="size-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="size-4 shrink-0" />}
                      <span className="min-w-0 wrap-anywhere">{group.name}</span>
                    </button>
                  </th>
                  <TotalsCells totals={group.subtotalByColumn} />
                </tr>
                {open && group.rows.map(({ closing, unit, volumes, farms }) => {
                  const showFarms = expandedProducts[closing.id] ?? true;
                  const product = closing.active ? `${closing.product} (${closing.active})` : closing.product;
                  return (
                    <Fragment key={closing.id}>
                      <tr className="bg-white text-slate-700 [&>td]:border-t [&>th]:border-t">
                        <th className={cn(identityColumn, "pl-7 font-medium")} scope="row">
                          {farms.length ? (
                            <button
                              aria-expanded={showFarms}
                              aria-label={`Entregas por fazenda de ${product}`}
                              className="flex w-full items-start gap-1 text-left text-slate-900 hover:underline"
                              onClick={() => setExpandedProducts((current) => ({ ...current, [closing.id]: !showFarms }))}
                              type="button"
                            >
                              {showFarms ? <ChevronDown aria-hidden="true" className="size-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="size-4 shrink-0" />}
                              <span className="min-w-0 wrap-anywhere">{product}</span>
                            </button>
                          ) : <span className="block wrap-anywhere text-slate-900">{product}</span>}
                          <span className="block wrap-anywhere text-[10px] font-normal leading-4 text-slate-500">
                            {[closing.destination, closing.deliveryLocation, closing.culture || closing.cycle].filter(Boolean).join(" · ")}
                          </span>
                        </th>
                        <DeliveryCells volumes={volumes} unit={unit} highlight />
                      </tr>
                      {showFarms && farms.map(({ farm, volumes: farmVolumes }) => (
                        <tr className="bg-slate-50 text-slate-700 [&>td]:border-t [&>th]:border-t" key={farm}>
                          <th className={cn(identityColumn, "pl-12 font-normal wrap-anywhere")} scope="row">{farm}</th>
                          <DeliveryCells volumes={farmVolumes} unit={unit} />
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            );
          })}
          {!activeGroups.length ? (
            <tbody>
              <tr>
                <td className="sticky left-0 px-2.5 py-5 text-slate-500">Sem entregas no período.</td>
                <td aria-hidden="true" colSpan={months.length + 1} />
              </tr>
            </tbody>
          ) : null}
        </table>
      </div>
    </section>
  );
}
