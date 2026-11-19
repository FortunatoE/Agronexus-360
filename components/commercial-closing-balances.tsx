"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import type { CommercialClosingGroup, CommercialClosingProduct } from "@/lib/commercial-closings";

const volumeFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const volumeCell = "px-3 py-2 text-right tabular-nums";
const headings = ["Nível / princípio ativo / material planejado", "Ciclo", "Planejado", "Fechado", "Falta fechar"];

function productTotals(products: CommercialClosingProduct[]) {
  const plannedProducts = products.filter((product) => product.planned !== null);
  return {
    planned: plannedProducts.length ? plannedProducts.reduce((sum, product) => sum + (product.planned ?? 0), 0) : null,
    closed: products.reduce((sum, product) => sum + product.closed, 0),
    remaining: plannedProducts.length ? plannedProducts.reduce((sum, product) => sum + (product.remaining ?? 0), 0) : null,
  };
}

export function CommercialClosingBalances({
  groups,
  expandMatches,
  empty,
}: {
  groups: CommercialClosingGroup[];
  expandMatches: boolean;
  empty: string;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});

  return (
    <section aria-labelledby="closing-balances-title" className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold" id="closing-balances-title">Quanto falta fechar</h3>
      <p className="mt-1 text-xs text-slate-500">Navegue por grupo, subgrupo, princípio ativo e material planejado. O último nível mostra os materiais fechados; a conversão usa o fator cadastrado em Premissas.</p>
      {groups.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {headings.map((heading, index) => (
                  <th className={index > 1 ? volumeCell : "px-3 py-2 text-left"} key={heading} scope="col">{heading}</th>
                ))}
              </tr>
            </thead>
            {groups.map((group) => {
              const groupOpen = expandedGroups[group.key] ?? (expandMatches || groups.length === 1);
              const GroupIcon = groupOpen ? ChevronDown : ChevronRight;
              const groupProducts = group.subgroups.flatMap((subgroup) => subgroup.actives.flatMap((active) => active.products));
              const groupTotals = productTotals(groupProducts);
              return (
                <tbody className="border-t border-slate-200" key={group.key}>
                  <tr className="bg-emerald-50 text-emerald-900">
                    <th className="px-3 py-2 text-left" scope="rowgroup">
                      <button
                        aria-expanded={groupOpen}
                        className="flex items-center gap-1.5 font-semibold hover:underline"
                        onClick={() => setExpandedGroups((current) => ({ ...current, [group.key]: !groupOpen }))}
                        type="button"
                      >
                        <GroupIcon aria-hidden="true" className="size-4" />
                        Grupo · {group.group}
                      </button>
                    </th>
                    <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Consolidado</td>
                    <td className={volumeCell}>{groupTotals.planned === null ? "—" : volumeFormat.format(groupTotals.planned)}</td>
                    <td className={`${volumeCell} text-emerald-800`}>{volumeFormat.format(groupTotals.closed)}</td>
                    <td className={`${volumeCell} font-bold ${(groupTotals.remaining ?? 0) > 0 ? "text-rose-700" : "text-emerald-800"}`}>{groupTotals.remaining === null ? "—" : volumeFormat.format(groupTotals.remaining)}</td>
                  </tr>
                  {groupOpen ? group.subgroups.map((subgroup) => {
                    const subgroupOpen = expandedGroups[subgroup.key] ?? expandMatches;
                    const SubgroupIcon = subgroupOpen ? ChevronDown : ChevronRight;
                    const subgroupProducts = subgroup.actives.flatMap((active) => active.products);
                    const subgroupTotals = productTotals(subgroupProducts);
                    return <Fragment key={subgroup.key}>
                      <tr className="border-t border-slate-100 bg-slate-50 text-slate-800">
                        <th className="py-2 pr-3 pl-8 text-left" scope="rowgroup">
                          <button aria-expanded={subgroupOpen} className="flex items-center gap-1.5 font-semibold hover:underline" onClick={() => setExpandedGroups((current) => ({ ...current, [subgroup.key]: !subgroupOpen }))} type="button">
                            <SubgroupIcon aria-hidden="true" className="size-4" />Subgrupo · {subgroup.subgroup}
                          </button>
                        </th>
                        <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Consolidado</td>
                        <td className={volumeCell}>{subgroupTotals.planned === null ? "—" : volumeFormat.format(subgroupTotals.planned)}</td>
                        <td className={`${volumeCell} text-emerald-800`}>{volumeFormat.format(subgroupTotals.closed)}</td>
                        <td className={`${volumeCell} font-bold ${(subgroupTotals.remaining ?? 0) > 0 ? "text-rose-700" : "text-emerald-800"}`}>{subgroupTotals.remaining === null ? "—" : volumeFormat.format(subgroupTotals.remaining)}</td>
                      </tr>
                      {subgroupOpen ? subgroup.actives.flatMap((active) => active.products.map((product) => {
                        const productOpen = expandedProducts[product.key] ?? expandMatches;
                        const ProductIcon = productOpen ? ChevronDown : ChevronRight;
                        const showDetails = product.details.length > 0;
                        return <Fragment key={product.key}>
                          <tr className="border-t border-slate-100 text-slate-900">
                            <th className="py-2 pr-3 pl-14 text-left font-semibold" scope="row">
                              {showDetails ? <button aria-expanded={productOpen} className="flex items-center gap-1.5 text-left hover:underline" onClick={() => setExpandedProducts((current) => ({ ...current, [product.key]: !productOpen }))} type="button"><ProductIcon aria-hidden="true" className="size-3.5 shrink-0" /><span>{active.active}<span className="ml-2 font-normal text-slate-500">| {product.product}</span></span></button> : <span className="pl-5">{active.active}<span className="ml-2 font-normal text-slate-500">| {product.product}</span></span>}
                            </th>
                            <td className="px-3 py-2">{product.cycle}</td>
                            <td className={volumeCell}>{product.planned === null ? "—" : volumeFormat.format(product.planned)}</td>
                            <td className={`${volumeCell} text-emerald-800`}>{volumeFormat.format(product.closed)}</td>
                            <td className={`${volumeCell} font-bold ${(product.remaining ?? 0) > 0 ? "text-rose-700" : "text-emerald-800"}`}>{product.remaining === null ? "—" : volumeFormat.format(product.remaining)}</td>
                          </tr>
                          {productOpen ? product.details.map((detail) => <tr className="border-t border-slate-100 bg-slate-50 text-xs text-slate-600" key={JSON.stringify([product.key, detail.product, detail.unit])}><th className="py-2 pr-3 pl-20 text-left font-medium" scope="row"><span className="text-emerald-700">Material fechado · </span>{detail.product}</th><td /><td /><td className={volumeCell}><span className="font-semibold text-emerald-800">{volumeFormat.format(detail.amount)}{detail.converted ? " convertido" : detail.unit ? ` ${detail.unit}` : ""}</span>{detail.converted ? <span className="mt-0.5 block text-[11px]">Saldo físico: {volumeFormat.format(detail.physical)}{detail.unit ? ` ${detail.unit}` : ""}</span> : null}</td><td /></tr>) : null}
                        </Fragment>;
                      })) : null}
                    </Fragment>;
                  }) : null}
                </tbody>
              );
            })}
          </table>
        </div>
      ) : <p className="py-8 text-center text-sm text-slate-500">{empty}</p>}
    </section>
  );
}
