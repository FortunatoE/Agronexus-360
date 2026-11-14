export type MaterialDimension = {
  material: string;
  principleActive: string;
  merchandiseGroup: string;
  subgroup: string;
  aggregateMaterial: string;
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

export function readMaterialDimension(rows: Record<string, unknown>[]) {
  const result = new Map<string, MaterialDimension>();
  for (const row of rows) {
    const material = String(row.Material ?? "").trim();
    if (!material) continue;
    const value: MaterialDimension = {
      material,
      principleActive: String(row["Princípio Ativo"] ?? row["Principio Ativo"] ?? "Não informado").trim(),
      merchandiseGroup: String(row["Grupo de mercadorias"] ?? row.Grupo ?? "Sem grupo").trim(),
      subgroup: String(row.Subgrupo ?? row.Sub_Grupo ?? "Sem subgrupo").trim(),
      aggregateMaterial: String(row["Material agregado"] ?? material).trim(),
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
