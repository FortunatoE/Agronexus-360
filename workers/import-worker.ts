import * as XLSX from "xlsx";
import { compactOperationalRow, headerKey, readText, type CompactSource, type OperationalRow } from "../lib/reconciliation";

type SourceKey = "planejamento" | "execucao" | "consumo" | "estoque" | "estoqueMb52" | "transito" | "pedidos" | "estoqueWeb" | "solicitacoesWeb" | "pedidosCompra";
type Request = { buffer: ArrayBuffer; header: number; id: string; key: SourceKey };

const compactSource: Partial<Record<SourceKey, CompactSource>> = {
  planejamento: "planning",
  execucao: "execution",
  consumo: "consumption",
  estoque: "stock",
  estoqueMb52: "stock",
  transito: "transit",
  pedidos: "pending",
};

function stockHeaderRow(sheet: XLSX.WorkSheet) {
  const preview = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }).slice(0, 8);
  const index = preview.findIndex((row) => {
    const headers = row.map(headerKey);
    const hasAvailableBalance = headers.includes(headerKey("Utilização livre")) || headers.includes(headerKey("Util.livre"));
    return (headers.includes("CENTRO") || headers.includes("CEN"))
      && headers.includes(headerKey("Texto breve material"))
      && hasAvailableBalance;
  });
  return index >= 0 ? index : 0;
}

function pendingRowsFrom(workbook: XLSX.WorkBook) {
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const preview = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }).slice(0, 15);
    const header = preview.findIndex((row) => {
      const headers = row.map(headerKey);
      return headers.includes(headerKey("Descrição Material"))
        && (headers.includes(headerKey("Saldo Forn")) || headers.includes(headerKey("Qtd.pedido")));
    });
    if (header < 0) continue;
    return XLSX.utils.sheet_to_json<OperationalRow>(sheet, { range: header, defval: "" })
      .filter((row) => Boolean(readText(row, "Descrição Material", "Descricao Material", "Produto solicitado")))
      .filter((row) => !["SIM", "S", "X", "TRUE"].includes(headerKey(readText(row, "Eliminado?", "Eliminado", "Cancelado"))));
  }
  throw new Error("Não localizei Descrição Material e Saldo Forn no arquivo de pedidos pendentes.");
}

function rowsFrom(workbook: XLSX.WorkBook, request: Request) {
  if (request.key === "pedidos") return pendingRowsFrom(workbook);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const header = request.key === "estoque" || request.key === "estoqueMb52" ? stockHeaderRow(sheet) : request.header;
  return XLSX.utils.sheet_to_json<OperationalRow>(sheet, { range: header, defval: "" });
}

self.onmessage = ({ data }: MessageEvent<Request>) => {
  try {
    const workbook = XLSX.read(data.buffer, { type: "array" });
    const sourceRows = rowsFrom(workbook, data);
    // As fontes webAgil alimentam a emissão de viagens e precisam conservar
    // campos como solicitação, lote, estoque, destino e operador logístico.
    // As demais fontes continuam compactadas para não sobrecarregar a base.
    const source = compactSource[data.key as keyof typeof compactSource];
    const rows = source ? sourceRows.map((row) => compactOperationalRow(row, source)) : sourceRows;
    self.postMessage({ id: data.id, rows, rowCount: sourceRows.length, sheets: workbook.SheetNames });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : "Não foi possível ler o arquivo." });
  }
};
