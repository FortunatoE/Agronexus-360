import { normalizeMaterial, type DimensionBundle } from "@/lib/material-dimension";
import { productFor, registeredConversionFactor } from "@/lib/reconciliation";

type ClosingRecord = {
  active: string;
  cycle: string;
  destination: string;
  orderKey: string;
  orderNumber: string;
  product: string;
  supplier: string;
  totalVolume: number;
  unit: string;
};

type LinkedOrder = { product: string; standardProduct: string; unit: string };
type PlannedClosingProduct = { active: string; cycle: string; merchandiseGroup: string; planned: number; product: string; subgroup: string };

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
};

export type CommercialClosingProduct = {
  key: string;
  product: string;
  cycle: string;
  planned: number | null;
  closed: number;
  remaining: number | null;
  details: ClosedProduct[];
};

export type CommercialClosingActive = { key: string; active: string; products: CommercialClosingProduct[] };
export type CommercialClosingSubgroup = { key: string; subgroup: string; actives: CommercialClosingActive[] };
export type CommercialClosingGroup = { key: string; group: string; subgroups: CommercialClosingSubgroup[] };

function knownActive(value: string | undefined) {
  const name = value?.trim() ?? "";
  const key = normalizeMaterial(name);
  return key && key !== "NAOINFORMADO" && key !== "NAOCONCILIADO" ? name : "";
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
    let key = `${product.canonicalKey}|${closing.cycle}`;
    let schedule = planning.get(key);

    if (!schedule) {
      const targets = targetsByPhysicalProduct.get(normalizeMaterial(physicalProduct));
      const candidates = [...(targets ?? [])].map((target) => `${target}|${closing.cycle}`).filter((candidate) => planning.has(candidate));
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
  ].some((value) => normalizeMaterial(value).includes(normalizedQuery));
}

export function buildCommercialClosingOverview<T extends ClosingRecord>(
  planning: ReadonlyMap<string, PlannedClosingProduct>,
  closings: ResolvedClosing<T>[],
  cycle: string,
  normalizedQuery: string,
) {
  const inCycle = (value: string) => cycle === "Todos" || value === cycle;
  type Balance = {
    active: string;
    cycle: string;
    entries: ResolvedClosing<T>[];
    merchandiseGroup: string;
    planned: number | null;
    product: string;
    subgroup: string;
  };
  type HierarchicalGroup = {
    key: string;
    group: string;
    subgroups: Map<string, {
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
    const key = entry.plannedKey ?? `sem-planejamento|${normalizeMaterial(entry.active)}|${entry.closing.cycle}`;
    const balance = balances.get(key) ?? {
      active: entry.active,
      product: "Sem vínculo com o planejamento",
      cycle: entry.closing.cycle,
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
    let closed = 0;
    // A busca seleciona o produto, mas sua pendência considera todos os vínculos.
    for (const entry of balance.planned === null ? matchingEntries : balance.entries) {
      const { closing, factor, physicalProduct } = entry;
      const unit = closing.unit?.trim().toUpperCase() || "";
      const detailKey = `${normalizeMaterial(physicalProduct)}|${unit}`;
      const detail = details.get(detailKey) ?? { product: physicalProduct, unit, physical: 0, amount: 0, converted: false };
      const amount = closing.totalVolume * factor;
      detail.amount += amount;
      detail.physical += closing.totalVolume;
      detail.converted ||= factor !== 1;
      closed += amount;
      details.set(detailKey, detail);
    }

    const groupName = balance.merchandiseGroup || "Sem grupo";
    const subgroupName = balance.subgroup || "Sem subgrupo";
    const groupKey = normalizeMaterial(groupName) || "SEMGRUPO";
    const subgroupKey = `${groupKey}|${normalizeMaterial(subgroupName) || "SEMSUBGRUPO"}`;
    const activeKey = `${subgroupKey}|${normalizeMaterial(active) || "NAOINFORMADO"}`;
    const group = groups.get(groupKey) ?? { key: groupKey, group: groupName, subgroups: new Map() };
    const subgroup = group.subgroups.get(subgroupKey) ?? { key: subgroupKey, subgroup: subgroupName, actives: new Map() };
    const activeGroup = subgroup.actives.get(activeKey) ?? { key: activeKey, active, products: [] };
    activeGroup.products.push({
      key,
      product: balance.product,
      cycle: balance.cycle,
      planned: balance.planned,
      closed,
      remaining: balance.planned === null ? null : Math.max(0, balance.planned - closed),
      details: [...details.values()].sort((left, right) => left.product.localeCompare(right.product, "pt-BR")),
    });
    subgroup.actives.set(activeKey, activeGroup);
    group.subgroups.set(subgroupKey, subgroup);
    groups.set(groupKey, group);
  }
  return {
    groups: [...groups.values()].sort((left, right) => left.group.localeCompare(right.group, "pt-BR")).map((group) => ({
      key: group.key,
      group: group.group,
      subgroups: [...group.subgroups.values()].sort((left, right) => left.subgroup.localeCompare(right.subgroup, "pt-BR")).map((subgroup) => ({
        key: subgroup.key,
        subgroup: subgroup.subgroup,
        actives: [...subgroup.actives.values()].sort((left, right) => left.active.localeCompare(right.active, "pt-BR")).map((active) => ({
          ...active,
          products: active.products.sort((left, right) => (right.remaining ?? -1) - (left.remaining ?? -1) || left.product.localeCompare(right.product, "pt-BR")),
        })),
      })),
    })),
    closings: includedClosings,
  };
}
