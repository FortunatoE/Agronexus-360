import { normalizeMaterial, type DimensionBundle } from "@/lib/material-dimension";
import { pendingOrderDetailFields, pendingOrderQuantityAliases } from "./pending-order-fields.mjs";
import { sapItemHeaders, sapLotHeaders, sapOrderHeaders, sapTransitDestinationHeaders, sapTransitQuantityHeaders, sapTransitSupplierHeaders, sapUnitHeaders } from "./sap-logistics-fields.mjs";

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
  stock: ["Util.livre", "Utilização livre", "Utiliza��o livre", "Utilizacao livre", "Saldo ajustado", "Estoque"],
  transit: sapTransitQuantityHeaders,
  consumption: ["Qtd.retirada", "Qtd retirada", "Quantidade", "Saldo ajustado"],
  pending: pendingOrderQuantityAliases,
};

export type CompactSource = ProductSource | "execution";

/**
 * Mantém apenas os campos que alimentam os visuais e os guarda com chaves
 * curtas. Arquivos SAP possuem dezenas de colunas repetidas por linha; essa
 * projeção reduz de forma importante a carga enviada ao navegador sem alterar
 * a conciliação operacional.
 */
export function compactOperationalRow(row: OperationalRow, source: CompactSource): OperationalRow {
  if (row._c === 1) return row;
  const compact: OperationalRow = { _c: 1 };
  // Normaliza cada cabeçalho uma única vez. Isto reduz drasticamente o custo
  // de ler arquivos SAP grandes no worker de importação.
  const values = new Map(Object.entries(row).map(([header, value]) => [headerKey(header), value]));
  const valueFor = (...aliases: string[]) => {
    for (const alias of aliases) {
      const candidate = headerKey(alias);
      const exact = values.get(candidate);
      if (exact !== undefined && exact !== null && (typeof exact === "number" || String(exact).trim())) return exact;
      if (candidate.length > 7) {
        for (const [header, value] of values) {
          if (header.startsWith(candidate) && value !== undefined && value !== null && (typeof value === "number" || String(value).trim())) return value;
        }
      }
    }
    return undefined;
  };
  const assign = (key: string, ...aliases: string[]) => {
    const value = valueFor(...aliases);
    if (value !== undefined && value !== null && (typeof value === "number" || String(value).trim())) compact[key] = value;
  };
  const productSource: ProductSource = source === "execution" ? "planning" : source;
  const quantitySource: ProductSource = source === "execution" ? "planning" : source;

  assign("s", "Status", "Situação", "Situacao");
  assign("cl", "Classificação", "Classificacao", "Classificac�o", "Tipo");
  assign("p", ...productFields[productSource]);
  // No planejamento, preserve a quantidade física separada da já ajustada.
  // A marca qr identifica a origem de q nas novas cargas; cargas antigas
  // podiam copiar aq para q quando não existia quantidade física.
  if (source === "planning") {
    const raw = valueFor("Qtde. talhão", "Qtde talhão") ?? values.get("QUANTIDADE");
    if (raw !== undefined && raw !== null && (typeof raw === "number" || String(raw).trim())) {
      compact.q = raw;
      compact.qr = 1;
    }
  } else {
    assign("q", ...quantityFields[quantitySource]);
  }
  assign("aq", "Volume ajustado (produto) padrão", "Volume ajustado (produto) padrao");
  assign("c", "Material", "Código material", "Codigo material", "MAT");
  assign("w", "WBS element", "WBS", "Elemento PEP", "Elemento WBS", "Def.proj.", "Def proj", "Projeto");
  assign("ce", "Cen.", "Centro", "CEN", "Fazenda", "Nome Fazenda");
  assign("t", "Talhao", "Talhão");
  assign("cu", "Cultura", "Cultura 1");
  assign("cy", "Ciclo Plantio", "Ciclo");
  assign("n", "Nucleo", "Núcleo");
  assign("d", "Dep.", "Depósito", "Deposito", "DEP");
  assign("op", "Nome Est.Esp.", "Nome Est Esp", "Armazém", "Armazem");
  assign("ct", "Local Est.Esp.", "Local Est Esp", "Cidade");
  assign("dg", "DiagRede", "Diagrama");
  assign("ta", "Tar.", "Operação", "Operacao", "Operações", "Operacoes", "Descr. Operação", "Descr Operação");
  assign("ac", "Atividade");
  assign("pa", "Área executar (HA)", "Area executar (HA)", "HA_plantio", "HA plantio", "HA_talhao", "HA talhão");
  assign("aa", "Área Executada", "Area Executada", "Qtde. executada");
  assign("pd", "Data de plantio", "Data Plantio", "Dt. Plantio", "Dt Plantio", "DT_Plantio", "DATA_PLANTIO", "Plantio");
  assign("nq", "Qtd.necess.", "Qtd necess.", "Quantidade necessária", "Quantidade necessaria");
  assign("ad", "DT_Aplicacao", "Data prevista", "Data planejada", "Data aplicação", "Data");
  assign("rd", "DtRemPed", "Dt. Rem. Ped", "Data remessa", "Previsão de utilização", "Previsao de utilizacao");
  assign("or", "Pedido", "Nº pedido", "No pedido", "Documento", "Doc. compra", "Solicitação", "Solicitacao");
  assign("ex", "Dt. Validade", "Dt Validade", "Data de validade", "Data Validade", "Validade");
  assign("va", "Valor total", "Valor Total", "Valor", "Val. total", "Valor estoque");
  assign("el", "Eliminado?", "Eliminado", "Cancelado");
  if (source === "stock" || source === "transit" || source === "pending") {
    assign("um", ...sapUnitHeaders);
  }
  if (source === "stock") assign("lot", ...sapLotHeaders);
  if (source === "transit") {
    assign("or", ...sapOrderHeaders);
    assign("oi", ...sapItemHeaders);
    assign("tc", ...sapTransitDestinationHeaders);
    assign("sc", ...sapTransitSupplierHeaders);
  }
  if (source === "pending") {
    assign("or", ...sapOrderHeaders);
    for (const { key, aliases } of Object.values(pendingOrderDetailFields)) assign(key, ...aliases);
  }
  return compact;
}

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

const compactAliasMap: Record<string, string> = {
  ...Object.fromEntries(sapOrderHeaders.map((alias) => [headerKey(alias), "or"])),
  ...Object.fromEntries(sapUnitHeaders.map((alias) => [headerKey(alias), "um"])),
  ...Object.fromEntries(sapLotHeaders.map((alias) => [headerKey(alias), "lot"])),
  ...Object.fromEntries(sapTransitQuantityHeaders.map((alias) => [headerKey(alias), "q"])),
  ...Object.fromEntries(sapTransitDestinationHeaders.map((alias) => [headerKey(alias), "tc"])),
  ...Object.fromEntries(sapTransitSupplierHeaders.map((alias) => [headerKey(alias), "sc"])),
  STATUS: "s", SITUACAO: "s", CLASSIFICACAO: "cl", TIPO: "cl",
  PRODUTO: "p", MATERIALPLANEJADO: "p", PRODUTOPLANEJADO: "p", TEXTOMATERIAL: "p", DESCRICAOMATERIAL: "p", TEXTOBREVEMATERIAL: "p", INSUMO: "p", PRODUTOSOLICITADO: "p", MATERIALSOLICITADO: "p",
  QTDETALHAO: "q", QUANTIDADE: "q", UTILLIVRE: "q", UTILIZACAOLIVRE: "q", SALDOAJUSTADO: "q", ESTOQUE: "q", QTDRETIRADA: "q", SALDOFORN: "q", SALDOFORNECEDOR: "q", QTDPEDIDO: "q", VOLUMESOLICITADO: "q",
  VOLUMEAJUSTADOPRODUTOPADRAO: "aq",
  MATERIAL: "c", CODIGOMATERIAL: "c", MAT: "c",
  WBSELEMENT: "w", WBS: "w", ELEMENTOPEP: "w", ELEMENTOWBS: "w", DEFPROJ: "w", PROJETO: "w",
  CEN: "ce", CENTRO: "ce", FAZENDA: "ce", NOMEFAZENDA: "ce", TALHAO: "t", CULTURA: "cu", CULTURA1: "cu", CICLOPLANTIO: "cy", CICLO: "cy", NUCLEO: "n",
  DEP: "d", DEPOSITO: "d", NOMEESTESP: "op", ARMAZEM: "op", LOCALESTESP: "ct", CIDADE: "ct",
  DIAGREDE: "dg", DIAGRAMA: "dg", TAR: "ta", OPERACAO: "ta", OPERACOES: "ta", DESCROPERACAO: "ta", ATIVIDADE: "ac",
  AREAEXECUTARHA: "pa", HAPLANTIO: "pa", HATALHAO: "pa", AREAEXECUTADA: "aa", QTDEEXECUTADA: "aa",
  DATADEPLANTIO: "pd", DATAPLANTIO: "pd", DTPLANTIO: "pd", PLANTIO: "pd",
  QTDNECESS: "nq", QUANTIDADENECESSARIA: "nq",
  DTAPLICACAO: "ad", DATAPREVISTA: "ad", DATAPLANEJADA: "ad", DATAAPLICACAO: "ad", DATA: "ad",
  DTREMPED: "rd", DATAREMESSA: "rd", PREVISAODEUTILIZACAO: "rd",
  PEDIDO: "or", NOPEDIDO: "or", DOCUMENTO: "or", DOCCOMPRA: "or", SOLICITACAO: "or",
  DTVALIDADE: "ex", DATADEVALIDADE: "ex", DATAVALIDADE: "ex", VALIDADE: "ex",
  VALORTOTAL: "va", VALTOTAL: "va", VALOR: "va", VALESTOQUE: "va", VALORESTOQUE: "va",
  ELIMINADO: "el", CANCELADO: "el",
};
const compactAliasCache = new Map<string, string | undefined>();

function compactKeyForAlias(alias: string) {
  if (compactAliasCache.has(alias)) return compactAliasCache.get(alias);
  const key = compactAliasMap[headerKey(alias)];
  compactAliasCache.set(alias, key);
  return key;
}

export function readValue(row: OperationalRow, ...aliases: string[]) {
  if (row._c === 1) {
    for (const alias of aliases) {
      const compactKey = compactKeyForAlias(alias);
      const value = compactKey ? row[compactKey] : undefined;
      if (value !== undefined && value !== null && (typeof value === "number" || String(value).trim())) return value;
    }
    return undefined;
  }
  for (const alias of aliases) {
    const candidate = headerKey(alias);
    const header = Object.keys(row).find((key) => {
      const current = headerKey(key);
      return current === candidate || (candidate.length > 7 && current.startsWith(candidate));
    });
    const value = header ? row[header] : undefined;
    if (value !== undefined && value !== null && (typeof value === "number" || String(value).trim())) return value;
  }
  return undefined;
}

export function readText(row: OperationalRow, ...aliases: string[]) {
  const value = readValue(row, ...aliases);
  if (value !== undefined) return String(value).trim();
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

export function readPendingOrderDetails(row: OperationalRow) {
  const field = (name: keyof typeof pendingOrderDetailFields) => {
    const { key, aliases } = pendingOrderDetailFields[name];
    return row._c === 1 ? row[key] : readValue(row, ...aliases);
  };
  const quantity = (value: unknown) => (
    (typeof value === "number" ? Number.isFinite(value) : /\d/.test(String(value ?? ""))) ? numberFrom(value) : null
  );
  const ordered = quantity(field("ordered"));
  const delivered = quantity(field("delivered"));
  const remaining = quantity(field("remaining"));
  return {
    item: String(field("item") ?? "").trim(),
    ordered: ordered ?? (delivered !== null && remaining !== null ? delivered + remaining : null),
    delivered: delivered ?? (ordered !== null && remaining !== null && ordered >= remaining ? ordered - remaining : null),
    remaining: remaining ?? (ordered !== null && delivered !== null ? Math.max(0, ordered - delivered) : null),
    recordedQuantity: row._c === 1 && ordered === null && delivered === null && remaining === null ? quantity(row.q) : null,
  };
}

export function readNumber(row: OperationalRow, ...aliases: string[]) {
  return numberFrom(readValue(row, ...aliases));
}

function wbsFrom(row: OperationalRow) {
  return readText(row, "WBS element", "WBS", "Elemento PEP", "Elemento WBS", "Def.proj.", "Def proj", "Projeto");
}

function wbsSegment(row: OperationalRow, position: number) {
  return wbsFrom(row).split(".").map((segment) => segment.trim()).filter(Boolean)[position] ?? "";
}

function centerFor(row: OperationalRow) {
  const direct = readText(row, "Cen.", "Centro", "CEN");
  if (direct) return direct;
  const wbs = wbsFrom(row);
  // No CN52, o centro ocupa as posições 5 a 8 do Elemento PEP, por exemplo
  // CR1.FBJ2.2627-BM01-5. O segmento do WBS mantém a leitura compatível.
  return wbsSegment(row, 1) || (wbs.length >= 8 ? wbs.slice(4, 8) : "");
}

function talhaoFor(row: OperationalRow) {
  const direct = readText(row, "Talhao", "Talhão");
  if (direct) return headerKey(direct);
  const wbs = wbsFrom(row);
  const fromHyphen = wbs.split("-").map((segment) => segment.trim()).filter(Boolean)[1] ?? "";
  const fromWbsPattern = wbsSegment(row, 3);
  return headerKey(fromHyphen || fromWbsPattern);
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
    const center = centerFor(row);
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
  const center = centerFor(row);
  const farm = wbsSegment(row, 1);
  return bundle.centerToNucleus[normalizeMaterial(center)]
    || farmToNucleus[normalizeMaterial(center)]
    || bundle.centerToNucleus[normalizeMaterial(farm)]
    || farmToNucleus[normalizeMaterial(farm)]
    || "Sem núcleo";
}

/** Applies the Talhão-based nucleus rule only to planning rows. */
export function planningNucleusFor(row: OperationalRow, bundle: DimensionBundle, farmToNucleus: Record<string, string>) {
  const talhao = talhaoFor(row);
  if (talhao.startsWith("TL")) return "NC-TP";
  if (talhao.startsWith("FM")) return "NC-STM";
  if (talhao.startsWith("BM")) return "NC-BBJ";
  return nucleusFor(row, bundle, farmToNucleus).replace(/NC-VER/g, "NC-AGV");
}

/** Applies the CN52 nucleus rules from the operational Power Query. */
export function consumptionNucleusFor(row: OperationalRow, bundle: DimensionBundle, farmToNucleus: Record<string, string>) {
  const center = headerKey(centerFor(row));
  const talhao = talhaoFor(row);
  if (center === "FBJ2" && talhao.startsWith("FM")) return "NC-STM";
  if (center === "FBJ2" && talhao.startsWith("BM")) return "NC-BBJ";
  if (talhao.startsWith("TL")) return "NC-TP";
  return nucleusFor(row, bundle, farmToNucleus);
}

/** Applies the depot overrides used in the MB52 Power Query only to stock data. */
export function stockNucleusFor(row: OperationalRow, bundle: DimensionBundle, farmToNucleus: Record<string, string>) {
  const center = headerKey(centerFor(row));
  const depot = headerKey(readText(row, "Dep.", "Depósito", "Deposito", "DEP"));
  // Regra operacional: todo estoque registrado no centro FVR1 atende ao NC-TP.
  if (center === "FVR1") return "NC-TP";
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
  const center = centerFor(row);
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

export function registeredConversionFactor(product: ResolvedProduct, bundle: DimensionBundle) {
  const factor = bundle.conversions[`${normalizeMaterial(product.canonicalName)}|${normalizeMaterial(product.rawName)}`];
  return Number.isFinite(factor) && factor > 0 ? factor : undefined;
}

/**
 * Expresses a physical material in the unit of its material agregado. The
 * Premissas sheet stores conversions as `material padrão|apresentação física`.
 * The factor is multiplicative: 0.5 means that 1,600 physical become 800 in
 * the unit of the aggregated material.
 */
export function conversionFactor(product: ResolvedProduct, bundle: DimensionBundle) {
  const explicit = registeredConversionFactor(product, bundle);
  if (explicit !== undefined) return explicit;
  // Fallback seguro para dimensões que já trazem as duas doses, mas ainda não
  // receberam a premissa de conversão explícita.
  const physicalDose = bundle.materials[normalizeMaterial(product.rawName)]?.standardDose || 0;
  const aggregateDose = bundle.materials[normalizeMaterial(product.canonicalName)]?.standardDose || 0;
  if (physicalDose > 0 && aggregateDose > 0 && Math.abs(physicalDose - aggregateDose) > 0.000_001) return physicalDose / aggregateDose;
  return 1;
}

export function standardAmount(amount: number, product: ResolvedProduct, bundle: DimensionBundle) {
  return amount * conversionFactor(product, bundle);
}

/**
 * Planning is reconciled with the Excel model: its adjusted volume, when
 * supplied, is already in the reference material's unit. Otherwise convert
 * the physical quantity once using the registered multiplier, or the inverse
 * of the Excel dose divisor (reference dose / substitute dose).
 */
export function standardPlanningAmount(amount: number, product: ResolvedProduct, bundle: DimensionBundle) {
  if (normalizeMaterial(product.rawName) === normalizeMaterial(product.canonicalName)) return amount;
  const multiplier = registeredConversionFactor(product, bundle);
  if (multiplier !== undefined) return amount * multiplier;
  const physical = bundle.materials[normalizeMaterial(product.rawName)];
  const reference = bundle.materials[normalizeMaterial(product.canonicalName)];
  const physicalDose = physical?.standardDose ?? 0;
  const referenceDose = reference?.standardDose ?? 0;
  // The aggregate entry can be a lookup alias for the physical material.
  // An alias is not evidence of a separate reference dose.
  if (physicalDose > 0 && referenceDose > 0 && normalizeMaterial(reference?.material) === normalizeMaterial(product.canonicalName)) {
    return amount / (physicalDose / referenceDose);
  }
  return amount;
}

export function standardQuantity(row: OperationalRow, source: ProductSource, product: ResolvedProduct, bundle: DimensionBundle) {
  const adjusted = readValue(row, "Volume ajustado (produto) padrão", "Volume ajustado (produto) padrao");
  const hasAdjusted = typeof adjusted === "number"
    ? Number.isFinite(adjusted)
    : /\d/.test(String(adjusted ?? ""));
  // An adjusted quantity supplied by Excel is the authoritative equivalent;
  // this also prevents converting an older compacted adjusted-only row twice.
  if (hasAdjusted) return numberFrom(adjusted);
  if (source === "planning") {
    const physical = quantityFor(row, source);
    return standardPlanningAmount(physical, product, bundle);
  }
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
    const target = ensure(product, consumptionNucleusFor(row, bundle, farmToNucleus), cycleFor(row, bundle), cultureFor(row));
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
