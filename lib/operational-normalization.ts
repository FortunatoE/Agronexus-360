export type SourceKey = "planejamento" | "execucao" | "consumo" | "estoque" | "transito";
export type SourceRow = Record<string, unknown>;

const fieldIndex: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5 };

function value(row: SourceRow, ...keys: string[]) {
  for (const key of keys) {
    const found = row[key];
    if (found !== undefined && found !== null && String(found).trim()) return String(found).trim();
  }
  return null;
}

function numberValue(row: SourceRow, ...keys: string[]) {
  const raw = value(row, ...keys);
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(raw: string | null) {
  if (!raw) return null;
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function normalizeOperationalRow(source: SourceKey, row: SourceRow, sourceRow: number) {
  const culture = value(row, "Cultura", "CULTURA");
  const farm = value(row, "Fazenda", "FAZENDA");
  const harvest = value(row, "Safra", "SAFRA");
  const field = value(row, "Talhão", "Talhao", "TALHÃO", "TALHAO");
  const division = value(row, "Índice da divisão talhão", "Indice da divisão talhão", "Índice", "Indice");
  const suppliedWbs = value(row, "Elemento WBS", "Elemento PEP", "WBS", "PEP");
  const divisionIndex = division ? fieldIndex[division.toUpperCase()] ?? division : null;
  const composedWbs = culture && farm && harvest && field && divisionIndex ? `${culture}.${farm}.${harvest}.${field}-${divisionIndex}` : null;
  const status = value(row, "Status", "STATUS");

  return {
    id: crypto.randomUUID(),
    source,
    sourceRow,
    status,
    wbs: suppliedWbs ?? composedWbs,
    operation: value(row, "Operação", "Operacao", "Atividade", "Operação SAP"),
    material: value(row, "Material", "Código material", "Cod. material"),
    product: value(row, "Produto", "Texto material", "Texto breve material"),
    center: value(row, "Centro", "Cen."),
    farm,
    field,
    harvest,
    scheduledDate: isoDate(value(row, "DT_Aplicacao", "Data planejada", "Data Aplicação")),
    executionDate: isoDate(value(row, "Data Exec. OS", "Data execução", "Data Execução")),
    quantity: numberValue(row, "Qtd.retirada", "Quantidade", "Consumo", "Utilização livre"),
    unit: value(row, "UMB", "UM", "Unidade"),
    area: numberValue(row, "Área Executada", "Área executar (HA)", "Area Executada"),
    isExcluded: source === "execucao" && status?.toUpperCase() === "EXCL",
    raw: JSON.stringify(row),
  };
}
