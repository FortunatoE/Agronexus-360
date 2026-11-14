"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { FileUp } from "lucide-react";
import { readMaterialDimension, type MaterialDimension } from "@/lib/material-dimension";

type Row = Record<string, unknown>;

export function DimensionUpload({ onLoaded }: { onLoaded: (items: Record<string, MaterialDimension>) => void }) {
  const [label, setLabel] = useState("Dimensões.xlsx (opcional)");
  const [count, setCount] = useState(0);
  async function load(file: File | undefined) {
    if (!file) return;
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.SheetNames.find(name => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().includes("PRINCIPIOATIVO"));
    if (!sheet) throw new Error("A aba Princípio Ativo não foi encontrada.");
    const rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[sheet], { defval: "" });
    const map = readMaterialDimension(rows);
    onLoaded(Object.fromEntries(map));
    setLabel(file.name);
    setCount(map.size);
  }
  return <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 p-4 hover:border-emerald-500"><input accept=".xlsx,.xls" className="sr-only" onChange={event => void load(event.target.files?.[0])} type="file" /><div className="flex items-center gap-3"><FileUp className="h-5 w-5 text-emerald-700" /><div><p className="text-sm font-semibold">Dimensões / Princípio ativo</p><p className="text-xs text-slate-500">{label}</p></div></div><span className="text-xs font-semibold text-emerald-700">{count ? `${count} vínculos` : "Selecionar"}</span></label>;
}
