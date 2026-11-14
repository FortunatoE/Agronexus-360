"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { FileUp } from "lucide-react";
import { normalizeMaterial, readMaterialDimension, type DimensionBundle } from "@/lib/material-dimension";

type Row = Record<string, unknown>;

function sparseValue(sheet: XLSX.WorkSheet, column: string, row: number) { return String(sheet[`${column}${row}`]?.v ?? "").trim(); }

function readPremises(sheet: XLSX.WorkSheet) {
  const centers: Record<string, string> = {}; const cultures: Record<string, string> = {}; const conversions: Record<string, number> = {};
  const rows = new Set<number>();
  Object.keys(sheet).forEach(cell => { const match = /^([HIPQTUVWXY])(\d+)$/.exec(cell); if (match) rows.add(Number(match[2])); });
  rows.forEach(row => {
    const center = sparseValue(sheet, "H", row), nucleus = sparseValue(sheet, "I", row);
    if (center && nucleus) centers[normalizeMaterial(center)] = nucleus;
    const culture = sparseValue(sheet, "P", row), cycle = sparseValue(sheet, "Q", row);
    if (culture && cycle) cultures[normalizeMaterial(culture)] = cycle;
    const product = sparseValue(sheet, "T", row), substitute = sparseValue(sheet, "U", row), factor = Number(sparseValue(sheet, "X", row).replace(",", "."));
    if (product && substitute && Number.isFinite(factor) && factor > 0) conversions[`${normalizeMaterial(product)}|${normalizeMaterial(substitute)}`] = factor;
  });
  return { centerToNucleus: centers, cultureToCycle: cultures, conversions };
}

export function DimensionUpload({ onLoaded }: { onLoaded: (bundle: DimensionBundle) => void }) {
  const [label, setLabel] = useState("Dimensões.xlsx (opcional)"); const [count, setCount] = useState(0);
  async function load(file: File | undefined) {
    if (!file) return;
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const activeSheet = workbook.SheetNames.find(name => normalizeMaterial(name).includes("PRINCIPIOATIVO"));
    if (!activeSheet) throw new Error("A aba Princípio Ativo não foi encontrada.");
    const map = readMaterialDimension(XLSX.utils.sheet_to_json<Row>(workbook.Sheets[activeSheet], { defval: "" }));
    const premisesName = workbook.SheetNames.find(name => normalizeMaterial(name) === "PREMISSAS");
    const premises = premisesName ? readPremises(workbook.Sheets[premisesName]) : { centerToNucleus: {}, cultureToCycle: {}, conversions: {} };
    onLoaded({ materials: Object.fromEntries(map), ...premises }); setLabel(file.name); setCount(map.size);
  }
  return <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 p-4 hover:border-emerald-500"><input accept=".xlsx,.xls" className="sr-only" onChange={event => void load(event.target.files?.[0])} type="file" /><div className="flex items-center gap-3"><FileUp className="h-5 w-5 text-emerald-700" /><div><p className="text-sm font-semibold">Dimensões / Princípio ativo</p><p className="text-xs text-slate-500">{label}</p></div></div><span className="text-xs font-semibold text-emerald-700">{count ? `${count} vínculos` : "Selecionar"}</span></label>;
}
