import { normalizeMaterial, type DimensionBundle } from "@/lib/material-dimension";

export type OperationalRow = Record<string, unknown>;
export type ProductSource = "planning" | "stock" | "transit" | "consumption" | "pending";
export type StockLocationType = "Fazenda" | "Armazém";

export type ResolvedProduct = {
  active: string;
  canonicalKey: string;
  canonicalName: string;
  code: string;
  merchandiseGroup: string;
  rawName: string;
  subgroup: string;
  resolvedByDimension: boolean;
};

export type LedgerLocation = {
  amount: number;
  location: string;
  material: string;
  type: "Fazenda" | "Armazém" | "Trânsito";
};

export type ReconciliationRow = {
  active: string;
  applied: number;
  available: number;
  canonicalKey: string;
  codes: string[];
  cultures: string[];
  cycles: string[];
  farmBalance: number;
  id: string;
  locations: LedgerLocation[];
  merchandiseGroup: string;
  nucleus: string;
  pendingOrder: number;
  planned: number;
  plannedMaterials: string[];
  shortage: number;
  standardMaterial: string;
  stockMaterials: string[];
  subgroup: string;
  transit: number;
  warehouseBalance: number;
};

type MutableLedgerRow = Omit<ReconciliationRow, "codes" | "cultures" | "cycles" | "plannedMaterials" | "stockMaterials" | "available" | "shortage"> & {
  codes: Set<string>;
  cultures: Set<string>;
  cycles: Set<string>;
  plannedMaterials: Set<string>;
  stockMaterials: Set<string>;
};

export type ReconciliationInput = {
  bundle: DimensionBundle;
  consumptionRows: OperationalRow[];
  farmToNucleus: Record<string, string>;
  pendingRows?: OperationalRow[];
  planningRows: OperationalRow[];
  stockRows: OperationalRow[];
  transitRows: OperationalRow[];
};

const productFields: Record<ProductSource, string[]> = {
  planning: ["Produto", "Material planejado", "Produto planejado", "Texto material", "Descrição material", "Descricao material"],
  stock: ["Texto breve material", "INSUMO", "Descrição material", "Descricao material", "Produto"],
  transit: ["Texto breve material", "INSUMO", "Descrição material", "Descricao material", "Produto"],
  consumption: ["Texto material", "Texto breve material", "INSUMO", "Descrição material", "Descricao material", "Produto"],
  pending: ["Descrição Material", "Descricao Material", "Produto solicitado", "Material solicitado", "Texto material", "Texto breve material"],
};

const quantityFields: Record<ProductSource, string[]> = {
  planning: ["Qtde. talhão", "Qtde talhão", "Volume ajustado (produto) padrão", "Quantidade"],
  stock: ["Utilização livre", "Utiliza��o livre", "Utilizacao livre", "Saldo ajustado", "Estoque"],
  transit: ["Quantidade", "Qtd.pedido", "Qtd pedido", "Saldo ajustado"],
  consumption: ["Qtd.retirada", "Qtd retirada", "Quantidade", "Saldo ajustado"],
  pending: ["Saldo Forn", "Saldo fornecedor", "Qtd.pedido", "Qtd pedido", "Volume solicitado", "Quantidade"],
};

const cropByCode: Record<string, { culture: string; cycle: string }> = {
  AL1: { culture: "Algodão", cycle: "Safrinha" },
  CC1: { culture: "Capim", cycle: "Safrinha" },
  CR1: { culture: "Corretivos", cycle: "Safra" },
  MI1: { culture: "Milho", cycle: "Safrinha" },
  ST1: { culture: "Soja", cycle: "Safra" },
};

export function headerKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFFFD/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function readText(row: OperationalRow, ...aliases: string[]) {
  for (const alias of aliases) {
    const candidate = headerKey(alias);
    const header = Object.keys(row).find((key) => {
      const current = headerKey(key);
      return current === candidate || (candidate.length > 7 && current.startsWith(candidate));
    });
    const value = header ? row[header] : undefined;
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function numberFrom(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim().replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(raw)
      ? raw.replace(/\./g, "")
      : raw;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
}

export function readNumber(row: OperationalRow, ...aliases: string[]) {
  return numberFrom(readText(row, ...aliases));
}

function wbsFrom(row: OperationalRow) {
  return readText(row, "WBS element", "WBS", "Elemento PEP", "Elemento WBS", "Def.proj.", "Def proj", "Projeto");
}

function wbsSegment(row: OperationalRow, position: number) {
  return wbsFrom(row).split(".").map((segment) => segment.trim()).filter(Boolean)[position] ?? "";
}

function titleCycle(value: string) {
  const normalized = headerKey(value);
  if (normalized.includes("SAFRINHA")) return "Safrinha";
  if (normalized.includes("SAFRA")) return "Safra";
  return "Sem ciclo";
}

export function cultureFor(row: OperationalRow) {
  const code = headerKey(wbsSegment(row, 0) || readText(row, "Cultura"));
  return cropByCode[code]?.culture ?? (readText(row, "Cultura", "Cultura 1") || "Sem cultura");
}

export function cycleFor(row: OperationalRow, bundle?: DimensionBundle) {
  const direct = readText(row, "Ciclo Plantio", "Ciclo");
  if (direct) return titleCycle(direct);
  const code = headerKey(wbsSegment(row, 0) || readText(row, "Cultura"));
  if (cropByCode[code]?.cycle) return cropByCode[code].cycle;
  const dimensionCycle = bundle?.cultureToCycle[normalizeMaterial(readText(row, "Cultura", "Cultura 1"))];
  return dimensionCycle ? titleCycle(dimensionCycle) : "Sem ciclo";
}

export function buildFarmToNucleus(rows: OperationalRow[], bundle: DimensionBundle, planningRows: OperationalRow[] = []) {
  const result: Record<string, string> = {};
  rows.forEach((row) => {
    const nucleus = readText(row, "Nucleo", "Núcleo");
    const farm = wbsSegment(row, 1);
    if (nucleus && farm) result[normalizeMaterial(farm)] = nucleus;
    const center = readText(row, "Cen.", "Centro", "CEN");
    if (nucleus && center) result[normalizeMaterial(center)] = nucleus;
  });
  Object.entries(bundle.centerToNucleus).forEach(([center, nucleus]) => {
    if (nucleus) result[center] = nucleus;
  });
  // A relação fazenda → núcleo precisa refletir as exceções do planejamento
  // para que consumo e execução, ligados pelo WBS, permaneçam conciliados.
  planningRows.forEach((row) => {
    const farm = wbsSegment(row, 1);
    const nucleus = planningNucleusFor(row, bundle, result);
    if (farm && nucleus !== "Sem núcleo") result[normalizeMaterial(farm)] = nucleus;
  });
  return result;
}

export function nucleusFor(row: OperationalRow, bundle: DimensionBundle, farmToNucleus: Record<string, string>) {
  const direct = readText(row, "Nucleo", "Núcleo");
  if (direct) return direct;
  const center = readText(row, "Cen.", "Centro", "CEN");
  const farm = wbsSegment(row, 1);
  return bundle.centerToNucleus[normalizeMaterial(center)]
    || farmToNucleus[normalizeMaterial(center)]
    || bundle.centerToNucleus[normalizeMaterial(farm)]
    || farmToNucleus[normalizeMaterial(farm)]
    || "Sem núcleo";
}

/** Applies the Talhão-based nucleus rule only to planning rows. */
export function planningNucleusFor(row: OperationalRow, bundle: DimensionBundle, farmToNucleus: Record<string, string>) {
  const talhao = headerKey(readText(row, "Talhao", "Talhão"));
  if (talhao.startsWith("TL")) return "NC-TP";
  if (talhao.startsWith("FM")) return "NC-STM";
  if (talhao.startsWith("BM")) return "NC-BBJ";
  return nucleusFor(row, bundle, farmToNucleus).replace(/NC-VER/g, "NC-AGV");
}

/** Applies the depot overrides used in the MB52 Power Query only to stock data. */
export function stockNucleusFor(row: OperationalRow, bundle: DimensionBundle, farmToNucleus: Record<string, string>) {
  const center = headerKey(readText(row, "Cen.", "Centro", "CEN"));
  const depot = headerKey(readText(row, "Dep.", "Depósito", "Deposito", "DEP"));
  if (center === "FBJ2" && depot === "TR01") return "NC-BBJ";
  if (center === "FBJ2" && depot === "UTS1") return "NC-STM";
  if (!depot) return "BRAVO";
  return nucleusFor(row, bundle, farmToNucleus);
}

export function productFor(row: OperationalRow, source: ProductSource, bundle: DimensionBundle): ResolvedProduct {
  const code = readText(row, "Material", "Código material", "Codigo material", "MAT");
  const described = readText(row, ...productFields[source]);
  // O código SAP pode ser preservado para auditoria, mas não pode ocupar o
  // lugar da descrição: ele não participa da chave de conciliação.
  const rawName = described;
  const dimension = rawName ? bundle.materials[normalizeMaterial(rawName)] : undefined;
  const canonicalName = dimension?.aggregateMaterial || rawName || "Sem descrição";
  const canonicalKey = rawName ? normalizeMaterial(canonicalName) : "SEM_DESCRICAO";

  return {
    active: dimension?.principleActive || "Não conciliado",
    canonicalKey,
    canonicalName,
    code,
    merchandiseGroup: dimension?.merchandiseGroup || "Sem grupo",
    rawName: rawName || "Sem descrição",
    subgroup: dimension?.subgroup || "Sem subgrupo",
    resolvedByDimension: Boolean(dimension),
  };
}

export function stockLocationFor(row: OperationalRow, nucleus: string) {
  const center = readText(row, "Cen.", "Centro", "CEN");
  const depot = readText(row, "Dep.", "Depósito", "Deposito", "DEP");
  const operator = readText(row, "Nome Est.Esp.", "Nome Est Esp", "Armazém", "Armazem");
  const city = readText(row, "Local Est.Esp.", "Local Est Esp", "Cidade");
  const isWarehouse = headerKey(center) === "0714" || !depot;
  const type: StockLocationType = isWarehouse ? "Armazém" : "Fazenda";
  const storageName = [operator, city].filter(Boolean).join(" - ");
  const place = isWarehouse
    ? storageName || `Armazém — ${center || "sem centro"}${depot ? ` / ${depot}` : " / sem depósito"}`
    : `Fazenda — ${nucleus} / ${depot}`;
  return { depot, type, place };
}

export function quantityFor(row: OperationalRow, source: ProductSource) {
  return readNumber(row, ...quantityFields[source]);
}

/**
 * Expresses a physical material in the unit of its material agregado. The
 * Premissas sheet stores conversions as `material padrão|apresentação física`.
 * This is the same division used by the legacy MB52 Power Query.
 */
export function standardAmount(amount: number, product: ResolvedProduct, bundle: DimensionBundle) {
  const conversion = bundle.conversions[`${normalizeMaterial(product.canonicalName)}|${normalizeMaterial(product.rawName)}`] || 1;
  return conversion > 0 ? amount / conversion : amount;
}

export function standardQuantity(row: OperationalRow, source: ProductSource, product: ResolvedProduct, bundle: DimensionBundle) {
  const adjusted = readText(row, "Volume ajustado (produto) padrão", "Volume ajustado (produto) padrao");
  if (adjusted) return numberFrom(adjusted);
  return standardAmount(quantityFor(row, source), product, bundle);
}

export function buildReconciliation({
  bundle,
  consumptionRows,
  farmToNucleus,
  pendingRows = [],
  planningRows,
  stockRows,
  transitRows,
}: ReconciliationInput): ReconciliationRow[] {
  const entries = new Map<string, MutableLedgerRow>();

  const ensure = (product: ResolvedProduct, nucleus: string, cycle = "Sem ciclo", culture = "Sem cultura") => {
    const id = `${product.canonicalKey}|${normalizeMaterial(nucleus)}`;
    const current = entries.get(id) || {
      active: product.active,
      applied: 0,
      canonicalKey: product.canonicalKey,
      codes: new Set<string>(),
      cultures: new Set<string>(),
      cycles: new Set<string>(),
      farmBalance: 0,
      id,
      locations: [],
      merchandiseGroup: product.merchandiseGroup,
      nucleus,
      pendingOrder: 0,
      planned: 0,
      plannedMaterials: new Set<string>(),
      standardMaterial: product.canonicalName,
      stockMaterials: new Set<string>(),
      subgroup: product.subgroup,
      transit: 0,
      warehouseBalance: 0,
    };
    if (product.active !== "Não conciliado") current.active = product.active;
    if (product.merchandiseGroup !== "Sem grupo") current.merchandiseGroup = product.merchandiseGroup;
    if (product.subgroup !== "Sem subgrupo") current.subgroup = product.subgroup;
    if (product.code) current.codes.add(product.code);
    if (cycle !== "Sem ciclo") current.cycles.add(cycle);
    if (culture !== "Sem cultura") current.cultures.add(culture);
    entries.set(id, current);
    return current;
  };

  planningRows.forEach((row) => {
    const product = productFor(row, "planning", bundle);
    if (product.rawName === "Sem descrição") return;
    const target = ensure(product, planningNucleusFor(row, bundle, farmToNucleus), cycleFor(row, bundle), cultureFor(row));
    target.planned += standardQuantity(row, "planning", product, bundle);
    target.plannedMaterials.add(product.rawName);
  });

  stockRows.forEach((row) => {
    const product = productFor(row, "stock", bundle);
    if (product.rawName === "Sem descrição") return;
    const amount = standardQuantity(row, "stock", product, bundle);
    // Saldos zerados não descrevem disponibilidade em fazenda ou armazém.
    if (amount === 0) return;
    const nucleus = stockNucleusFor(row, bundle, farmToNucleus);
    const target = ensure(product, nucleus);
    const location = stockLocationFor(row, nucleus);
    if (location.type === "Fazenda") target.farmBalance += amount;
    else target.warehouseBalance += amount;
    target.stockMaterials.add(product.rawName);
    target.locations.push({ amount, location: location.place, material: product.rawName, type: location.type });
  });

  transitRows.forEach((row) => {
    const product = productFor(row, "transit", bundle);
    if (product.rawName === "Sem descrição") return;
    const nucleus = nucleusFor(row, bundle, farmToNucleus);
    const target = ensure(product, nucleus);
    const amount = standardQuantity(row, "transit", product, bundle);
    target.transit += amount;
    target.stockMaterials.add(product.rawName);
    target.locations.push({ amount, location: `Trânsito — ${nucleus}`, material: product.rawName, type: "Trânsito" });
  });

  consumptionRows.forEach((row) => {
    const product = productFor(row, "consumption", bundle);
    if (product.rawName === "Sem descrição") return;
    const target = ensure(product, nucleusFor(row, bundle, farmToNucleus), cycleFor(row, bundle), cultureFor(row));
    target.applied += standardQuantity(row, "consumption", product, bundle);
    target.plannedMaterials.add(product.rawName);
  });

  pendingRows.forEach((row) => {
    const product = productFor(row, "pending", bundle);
    if (product.rawName === "Sem descrição") return;
    const target = ensure(product, nucleusFor(row, bundle, farmToNucleus));
    target.pendingOrder += standardQuantity(row, "pending", product, bundle);
    target.plannedMaterials.add(product.rawName);
  });

  return [...entries.values()]
    .map((entry) => {
      const available = entry.farmBalance + entry.warehouseBalance + entry.transit;
      return {
        ...entry,
        available,
        codes: [...entry.codes],
        cultures: [...entry.cultures].sort(),
        cycles: [...entry.cycles].sort(),
        plannedMaterials: [...entry.plannedMaterials].sort(),
        shortage: Math.max(0, entry.planned - entry.applied - available),
        stockMaterials: [...entry.stockMaterials].sort(),
      };
    })
    .filter((entry) => entry.planned || entry.applied || entry.available || entry.pendingOrder)
    .sort((left, right) => right.shortage - left.shortage || left.standardMaterial.localeCompare(right.standardMaterial));
}
