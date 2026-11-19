"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import type { CommercialClosingGroup } from "@/lib/commercial-closings";

const volumeFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const volumeCell = "px-3 py-2 text-right tabular-nums";
const headings = ["Princípio ativo / produto", "Ciclo", "Planejado", "Fechado", "Falta fechar"];

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
      <p className="mt-1 text-xs text-slate-500">O saldo considera os fechamentos vinculados no ciclo. A conversão de dose usa o fator cadastrado em Premissas.</p>
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
              return (
                <tbody className="border-t border-slate-200" key={group.key}>
                  <tr className="bg-emerald-50 text-emerald-900">
                    <th className="px-3 py-2 text-left" colSpan={5} scope="rowgroup">
                      <button
                        aria-expanded={groupOpen}
                        className="flex items-center gap-1.5 font-semibold hover:underline"
                        onClick={() => setExpandedGroups((current) => ({ ...current, [group.key]: !groupOpen }))}
                        type="button"
                      >
                        <GroupIcon aria-hidden="true" className="size-4" />
                        {group.active}
                      </button>
                    </th>
                  </tr>
                  {groupOpen ? group.products.map((product) => {
                    const productOpen = expandedProducts[product.key] ?? expandMatches;
                    const ProductIcon = productOpen ? ChevronDown : ChevronRight;
                    const showDetails = product.details.length > 0;
                    return (
                      <Fragment key={product.key}>
                        <tr className="border-t border-slate-100 text-slate-900">
                          <th className="py-2 pr-3 pl-7 text-left font-semibold" scope="row">
                            {showDetails ? (
                              <button
                                aria-expanded={productOpen}
                                className="flex items-center gap-1.5 text-left hover:underline"
                                onClick={() => setExpandedProducts((current) => ({ ...current, [product.key]: !productOpen }))}
                                type="button"
                              >
                                <ProductIcon aria-hidden="true" className="size-3.5 shrink-0" />
                                {product.product}
                              </button>
                            ) : <span className="pl-5">{product.product}</span>}
                          </th>
                          <td className="px-3 py-2">{product.cycle}</td>
                          <td className={volumeCell}>{product.planned === null ? "—" : volumeFormat.format(product.planned)}</td>
                          <td className={`${volumeCell} text-emerald-800`}>{product.planned === null ? "—" : volumeFormat.format(product.closed)}</td>
                          <td className={`${volumeCell} font-bold ${(product.remaining ?? 0) > 0 ? "text-rose-700" : "text-emerald-800"}`}>
                            {product.remaining === null ? "—" : volumeFormat.format(product.remaining)}
                          </td>
                        </tr>
                        {productOpen ? product.details.map((detail) => (
                          <tr className="border-t border-slate-100 bg-slate-50 text-xs text-slate-600" key={JSON.stringify([detail.product, detail.unit])}>
                            <th className="py-2 pr-3 pl-14 text-left font-medium" scope="row">{detail.product}</th>
                            <td />
                            <td />
                            <td className={volumeCell}>
                              <span className="font-semibold text-emerald-800">
                                {volumeFormat.format(detail.amount)}{detail.converted ? " convertido" : detail.unit ? ` ${detail.unit}` : ""}
                              </span>
                              {detail.converted ? (
                                <span className="mt-0.5 block text-[11px]">Saldo físico: {volumeFormat.format(detail.physical)}{detail.unit ? ` ${detail.unit}` : ""}</span>
                              ) : null}
                            </td>
                            <td />
                          </tr>
                        )) : null}
                      </Fragment>
                    );
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
