import { normalizeMaterial, type DimensionBundle } from "@/lib/material-dimension";
import { productFor, registeredConversionFactor } from "@/lib/reconciliation";

type ClosingRecord = {
  active: string;
  cycle: string;
  culture: string;
  destination: string;
  groupName?: string;
  groupFarms?: { name: string }[];
  orderKey: string;
  orderNumber: string;
  product: string;
  supplier: string;
  totalVolume: number;
  unit: string;
  currency?: string;
  unitPrice?: number;
};

type LinkedOrder = { product: string; standardProduct: string; unit: string };
export type PlannedClosingProduct = {
  active: string;
  cycle: string;
  culture: string;
  merchandiseGroup: string;
  planned: number;
  product: string;
  subgroup: string;
};

export type CommercialPlanningCoverage = {
  applied: number;
  stock: number;
};

export function commercialPlanningKey(
  material: string,
  cycle: string,
  culture: string,
) {
  return [
    normalizeMaterial(material),
    normalizeMaterial(cycle) || "SEM_CICLO",
    normalizeMaterial(culture) || "SEM_CULTURA",
  ].join("|");
}

type ResolvedClosing<T extends ClosingRecord> = {
  closing: T;
  active: string;
  physicalProduct: string;
  standardProduct: string;
  plannedKey: string | null;
  factor: number;
  merchandiseGroup: string;
  subgroup: string;
};

type ClosedProduct = {
  product: string;
  unit: string;
  physical: number;
  amount: number;
  converted: boolean;
  averagePrices: CommercialAveragePrice[];
  suppliers: CommercialClosingSupplierPrice[];
};

export type CommercialAveragePrice = {
  average: number;
  currency: string;
  volume: number;
};
export type CommercialClosingSupplierPrice = CommercialAveragePrice & {
  supplier: string;
};

export type CommercialClosingProduct = {
  key: string;
  product: string;
  cycle: string;
  culture: string;
  planned: number | null;
  applied: number;
  stockCoverage: number;
  closed: number;
  remaining: number | null;
  details: ClosedProduct[];
  averagePrices: CommercialAveragePrice[];
};

export type CommercialClosingActive = { key: string; active: string; products: CommercialClosingProduct[]; averagePrices: CommercialAveragePrice[] };
export type CommercialClosingSubgroup = { key: string; subgroup: string; actives: CommercialClosingActive[]; averagePrices: CommercialAveragePrice[] };
export type CommercialClosingGroup = { key: string; group: string; subgroups: CommercialClosingSubgroup[]; averagePrices: CommercialAveragePrice[] };

function knownActive(value: string | undefined) {
  const name = value?.trim() ?? "";
  const key = normalizeMaterial(name);
  return key && key !== "NAOINFORMADO" && key !== "NAOCONCILIADO" ? name : "";
}

function averagePrices<T extends ClosingRecord>(entries: ResolvedClosing<T>[]) {
  const values = new Map<string, { value: number; volume: number }>();
  entries.forEach(({ closing }) => {
    const volume = Number(closing.totalVolume) || 0;
    const price = Number(closing.unitPrice);
    const currency = closing.currency?.trim().toUpperCase() || "SEM MOEDA";
    if (volume <= 0 || !Number.isFinite(price) || price < 0) return;
    const current = values.get(currency) || { value: 0, volume: 0 };
    current.value += volume * price;
    current.volume += volume;
    values.set(currency, current);
  });
  return [...values.entries()]
    .map(([currency, value]) => ({
      average: value.volume ? value.value / value.volume : 0,
      currency,
      volume: value.volume,
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

function mergeAveragePrices(values: CommercialAveragePrice[][]) {
  const totals = new Map<string, { value: number; volume: number }>();
  values.flat().forEach((item) => {
    const current = totals.get(item.currency) || { value: 0, volume: 0 };
    current.value += item.average * item.volume;
    current.volume += item.volume;
    totals.set(item.currency, current);
  });
  return [...totals.entries()]
    .map(([currency, value]) => ({
      average: value.volume ? value.value / value.volume : 0,
      currency,
      volume: value.volume,
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

function supplierPrices<T extends ClosingRecord>(entries: ResolvedClosing<T>[]) {
  const bySupplier = new Map<string, ResolvedClosing<T>[]>();
  entries.forEach((entry) => {
    const supplier = entry.closing.supplier.trim() || "Fornecedor não informado";
    const current = bySupplier.get(supplier) || [];
    current.push(entry);
    bySupplier.set(supplier, current);
  });
  return [...bySupplier.entries()].flatMap(([supplier, rows]) =>
    averagePrices(rows).map((price) => ({ ...price, supplier })),
  );
}

export function resolveCommercialClosings<T extends ClosingRecord>(
  closings: T[],
  planning: ReadonlyMap<string, PlannedClosingProduct>,
  dimensions: DimensionBundle,
  orders: ReadonlyMap<string, LinkedOrder>,
): ResolvedClosing<T>[] {
  const targetsByPhysicalProduct = new Map<string, Set<string>>();
  for (const [pair, factor] of Object.entries(dimensions.conversions)) {
    const [target, physical] = pair.split("|");
    if (!target || !physical || !Number.isFinite(factor) || factor <= 0) continue;
    const targets = targetsByPhysicalProduct.get(physical) ?? new Set<string>();
    targets.add(target);
    targetsByPhysicalProduct.set(physical, targets);
  }

  return closings.map((closing) => {
    const order = orders.get(closing.orderKey);
    // O vínculo antigo preenchia o produto padrão e mantinha a unidade física do pedido.
    const usesLinkedOrderMaterial = order
      && normalizeMaterial(closing.product) === normalizeMaterial(order.standardProduct)
      && normalizeMaterial(closing.unit) === normalizeMaterial(order.unit);
    const physicalProduct = usesLinkedOrderMaterial ? order.product : closing.product;
    let product = productFor({ Produto: physicalProduct }, "planning", dimensions);
    let key = commercialPlanningKey(
      product.canonicalKey,
      closing.cycle,
      closing.culture,
    );
    let schedule = planning.get(key);

    if (!schedule) {
      const targets = targetsByPhysicalProduct.get(normalizeMaterial(physicalProduct));
      const candidates = [...(targets ?? [])]
        .map((target) =>
          commercialPlanningKey(target, closing.cycle, closing.culture),
        )
        .filter((candidate) => planning.has(candidate));
      if (candidates.length === 1) {
        key = candidates[0];
        schedule = planning.get(key);
        if (schedule) product = { ...product, canonicalName: schedule.product, canonicalKey: normalizeMaterial(schedule.product) };
      }
    }

    const canonicalActive = dimensions.materials[product.canonicalKey]?.principleActive;
    const active = knownActive(schedule?.active) || knownActive(canonicalActive) || knownActive(product.active) || knownActive(closing.active);
    return {
      closing,
      active,
      physicalProduct,
      standardProduct: product.canonicalName,
      plannedKey: schedule ? key : null,
      factor: schedule ? registeredConversionFactor(product, dimensions) ?? 1 : 1,
      merchandiseGroup: schedule?.merchandiseGroup || product.merchandiseGroup || "Sem grupo",
      subgroup: schedule?.subgroup || product.subgroup || "Sem subgrupo",
    };
  });
}

export function matchesCommercialClosing(entry: ResolvedClosing<ClosingRecord>, normalizedQuery: string) {
  const { closing, active, physicalProduct, standardProduct } = entry;
  return !normalizedQuery || [
    active, closing.active, closing.product, physicalProduct, standardProduct, closing.supplier, closing.destination, closing.orderNumber,
    closing.groupName || "", ...(closing.groupFarms || []).map((farm) => farm.name),
  ].some((value) => normalizeMaterial(value).includes(normalizedQuery));
}

export function buildCommercialClosingOverview<T extends ClosingRecord>(
  planning: ReadonlyMap<string, PlannedClosingProduct>,
  closings: ResolvedClosing<T>[],
  cycle: string,
  normalizedQuery: string,
  coverageByPlanningKey: ReadonlyMap<string, CommercialPlanningCoverage> = new Map(),
) {
  const inCycle = (value: string) => cycle === "Todos" || value === cycle;
  type Balance = {
    active: string;
    cycle: string;
    culture: string;
    entries: ResolvedClosing<T>[];
    merchandiseGroup: string;
    planned: number | null;
    product: string;
    subgroup: string;
  };
  type HierarchicalGroup = {
    averagePrices: CommercialAveragePrice[];
    key: string;
    group: string;
    subgroups: Map<string, {
      averagePrices: CommercialAveragePrice[];
      key: string;
      subgroup: string;
      actives: Map<string, CommercialClosingActive>;
    }>;
  };
  const balances = new Map<string, Balance>();
  for (const [key, schedule] of planning) {
    if (inCycle(schedule.cycle)) balances.set(key, { ...schedule, entries: [] });
  }
  for (const entry of closings) {
    if (!inCycle(entry.closing.cycle)) continue;
    const key = entry.plannedKey ?? [
      "sem-planejamento",
      normalizeMaterial(entry.active),
      normalizeMaterial(entry.closing.cycle),
      normalizeMaterial(entry.closing.culture),
    ].join("|");
    const balance = balances.get(key) ?? {
      active: entry.active,
      product: "Sem vínculo com o planejamento",
      cycle: entry.closing.cycle,
      culture: entry.closing.culture,
      merchandiseGroup: entry.merchandiseGroup,
      planned: null,
      subgroup: entry.subgroup,
      entries: [],
    };
    balance.entries.push(entry);
    balances.set(key, balance);
  }

  const groups = new Map<string, HierarchicalGroup>();
  const includedClosings: T[] = [];
  for (const [key, balance] of balances) {
    const active = knownActive(balance.active) || balance.entries.find((entry) => entry.active)?.active || "Não informado";
    const matchesProduct = !normalizedQuery
      || normalizeMaterial(active).includes(normalizedQuery)
      || normalizeMaterial(balance.merchandiseGroup).includes(normalizedQuery)
      || normalizeMaterial(balance.subgroup).includes(normalizedQuery)
      || (balance.planned !== null && normalizeMaterial(balance.product).includes(normalizedQuery));
    const matchingEntries = matchesProduct ? balance.entries : balance.entries.filter((entry) => matchesCommercialClosing(entry, normalizedQuery));
    if (!matchesProduct && !matchingEntries.length) continue;

    for (const { closing } of matchingEntries) includedClosings.push(closing);

    const details = new Map<string, ClosedProduct>();
    const detailEntries = new Map<string, ResolvedClosing<T>[]>();
    const pricingEntries = balance.planned === null ? matchingEntries : balance.entries;
    let closed = 0;
    // A busca seleciona o produto, mas sua pendência considera todos os vínculos.
    for (const entry of pricingEntries) {
      const { closing, factor, physicalProduct } = entry;
      const unit = closing.unit?.trim().toUpperCase() || "";
      const detailKey = `${normalizeMaterial(physicalProduct)}|${unit}`;
      const detail = details.get(detailKey) ?? {
        product: physicalProduct,
        unit,
        physical: 0,
        amount: 0,
        converted: false,
        averagePrices: [],
        suppliers: [],
      };
      const amount = closing.totalVolume * factor;
      detail.amount += amount;
      detail.physical += closing.totalVolume;
      detail.converted ||= factor !== 1;
      closed += amount;
      details.set(detailKey, detail);
      const materialEntries = detailEntries.get(detailKey) || [];
      materialEntries.push(entry);
      detailEntries.set(detailKey, materialEntries);
    }

    const resolvedDetails = [...details.entries()]
      .map(([detailKey, detail]) => ({
        ...detail,
        averagePrices: averagePrices(detailEntries.get(detailKey) || []),
        suppliers: supplierPrices(detailEntries.get(detailKey) || []),
      }))
      .sort((left, right) => left.product.localeCompare(right.product, "pt-BR"));

    const groupName = balance.merchandiseGroup || "Sem grupo";
    const subgroupName = balance.subgroup || "Sem subgrupo";
    const groupKey = normalizeMaterial(groupName) || "SEMGRUPO";
    const subgroupKey = `${groupKey}|${normalizeMaterial(subgroupName) || "SEMSUBGRUPO"}`;
    const activeKey = `${subgroupKey}|${normalizeMaterial(active) || "NAOINFORMADO"}`;
    const group = groups.get(groupKey) ?? {
      averagePrices: [],
      key: groupKey,
      group: groupName,
      subgroups: new Map(),
    };
    const subgroup = group.subgroups.get(subgroupKey) ?? {
      averagePrices: [],
      key: subgroupKey,
      subgroup: subgroupName,
      actives: new Map(),
    };
    const activeGroup = subgroup.actives.get(activeKey) ?? {
      averagePrices: [],
      key: activeKey,
      active,
      products: [],
    };
    const coverage = balance.planned === null
      ? { applied: 0, stock: 0 }
      : coverageByPlanningKey.get(key) || { applied: 0, stock: 0 };
    const product = {
      key,
      product: balance.product,
      cycle: balance.cycle,
      culture: balance.culture,
      planned: balance.planned,
      applied: coverage.applied,
      stockCoverage: coverage.stock,
      closed,
      remaining: balance.planned === null
        ? null
        : Math.max(0, balance.planned - closed - coverage.applied - coverage.stock),
      details: resolvedDetails,
      averagePrices: averagePrices(pricingEntries),
    };
    activeGroup.products.push(product);
    activeGroup.averagePrices = mergeAveragePrices(
      activeGroup.products.map((item) => item.averagePrices),
    );
    subgroup.actives.set(activeKey, activeGroup);
    subgroup.averagePrices = mergeAveragePrices([
      ...subgroup.actives.values(),
    ].map((item) => item.averagePrices));
    group.subgroups.set(subgroupKey, subgroup);
    group.averagePrices = mergeAveragePrices(
      [...group.subgroups.values()].map((item) => item.averagePrices),
    );
    groups.set(groupKey, group);
  }
  return {
    groups: [...groups.values()].sort((left, right) => left.group.localeCompare(right.group, "pt-BR")).map((group) => ({
      key: group.key,
      group: group.group,
      averagePrices: group.averagePrices,
      subgroups: [...group.subgroups.values()].sort((left, right) => left.subgroup.localeCompare(right.subgroup, "pt-BR")).map((subgroup) => ({
        key: subgroup.key,
        subgroup: subgroup.subgroup,
        averagePrices: subgroup.averagePrices,
        actives: [...subgroup.actives.values()].sort((left, right) => left.active.localeCompare(right.active, "pt-BR")).map((active) => ({
          ...active,
          products: active.products.sort((left, right) => (right.remaining ?? -1) - (left.remaining ?? -1) || left.product.localeCompare(right.product, "pt-BR")),
        })),
      })),
    })),
    closings: includedClosings,
  };
}
