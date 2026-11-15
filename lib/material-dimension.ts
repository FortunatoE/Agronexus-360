export type MaterialDimension = {
  material: string;
  principleActive: string;
  merchandiseGroup: string;
  subgroup: string;
  aggregateMaterial: string;
  target: string;
  standardDose: number;
};

export type DimensionBundle = {
  materials: Record<string, MaterialDimension>;
  centerToNucleus: Record<string, string>;
  cultureToCycle: Record<string, string>;
  conversions: Record<string, number>;
};

export const emptyDimensionBundle: DimensionBundle = { materials: {}, centerToNucleus: {}, cultureToCycle: {}, conversions: {} };

export function normalizeMaterial(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function dimensionValue(row: Record<string, unknown>, ...aliases: string[]) {
  for (const alias of aliases) {
    const candidate = normalizeMaterial(alias);
    const key = Object.keys(row).find((header) => normalizeMaterial(header) === candidate);
    const value = key ? row[key] : undefined;
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function dimensionNumber(value: string) {
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function readMaterialDimension(rows: Record<string, unknown>[]) {
  const result = new Map<string, MaterialDimension>();
  for (const row of rows) {
    const material = dimensionValue(row, "Material");
    if (!material) continue;
    const value: MaterialDimension = {
      material,
      principleActive: dimensionValue(row, "Princípio Ativo", "Principio Ativo") || "Não informado",
      merchandiseGroup: dimensionValue(row, "Grupo de mercadorias", "Grupo") || "Sem grupo",
      subgroup: dimensionValue(row, "Subgrupo", "Sub_Grupo") || "Sem subgrupo",
      aggregateMaterial: dimensionValue(row, "Material agregado") || material,
      target: dimensionValue(row, "Alvo"),
      standardDose: dimensionNumber(dimensionValue(row, "Dose padrão", "Dose padrao")),
    };
    result.set(normalizeMaterial(material), value);
    // A dimensão pode conter diversas apresentações para o mesmo material
    // agregado. A apresentação física sempre tem precedência; o agregado é
    // apenas um atalho de consulta e não pode substituir um vínculo já lido.
    const aggregateKey = normalizeMaterial(value.aggregateMaterial);
    if (!result.has(aggregateKey)) result.set(aggregateKey, value);
  }
  return result;
}
