import { normalizeMaterial } from "./material-dimension";
import { headerKey, quantityFor, readPendingOrderDetails, readText, type OperationalRow } from "./reconciliation";
import { sapItemHeaders, sapLotHeaders, sapOrderHeaders, sapTransitDestinationHeaders, sapUnitHeaders } from "./sap-logistics-fields.mjs";

export function sapIdentifier(value: string) {
  const key = normalizeMaterial(value);
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "") : key;
}

export function logisticsUnit(value: string) {
  const unit = normalizeMaterial(value);
  const aliases: Record<string, string> = { LT: "L", LTR: "L", KGM: "KG", UND: "UN", UNID: "UN" };
  return aliases[unit] || unit;
}

export function pendingSapQuantity(row: OperationalRow) {
  return readPendingOrderDetails(row).remaining ?? quantityFor(row, "pending");
}

type PendingLine = { reference: string; physicalMaterial: string; row: OperationalRow };

export function matchPendingTransit(pending: PendingLine[], inTransit: OperationalRow[]) {
  const orders = new Map<string, Array<{
    row: OperationalRow; item: string; material: string; code: string; destination: string; unit: string; quantity: number;
  }>>();
  for (const { reference, physicalMaterial, row } of pending) {
    const order = sapIdentifier(reference);
    const quantity = pendingSapQuantity(row);
    if (!order || quantity <= 0) continue;
    const lines = orders.get(order) || [];
    lines.push({
      row, quantity,
      item: sapIdentifier(readPendingOrderDetails(row).item || readText(row, ...sapItemHeaders)),
      material: normalizeMaterial(physicalMaterial),
      code: sapIdentifier(readText(row, "Material", "Código material", "MAT")),
      destination: sapIdentifier(readText(row, "Centro", "CEN")),
      unit: logisticsUnit(readText(row, ...sapUnitHeaders)),
    });
    orders.set(order, lines);
  }

  const transitByRow = new Map<OperationalRow, number>();
  for (const row of inTransit) {
    const lines = orders.get(sapIdentifier(readText(row, ...sapOrderHeaders, "Documento")));
    let amount = quantityFor(row, "transit");
    if (!lines || amount <= 0 || ["X", "S", "SIM", "TRUE"].includes(headerKey(readText(row, "Eliminado?", "Cancelado")))) continue;
    const item = sapIdentifier(readPendingOrderDetails(row).item || readText(row, ...sapItemHeaders));
    const code = sapIdentifier(readText(row, "Material", "Código material", "MAT"));
    const material = normalizeMaterial(readText(row, "Texto breve material", "Descrição material", "Insumo", "Produto"));
    const destination = sapIdentifier(readText(row, ...sapTransitDestinationHeaders));
    const unit = logisticsUnit(readText(row, ...sapUnitHeaders));
    const matches = lines.filter((line) => {
      if (item && line.item && item !== line.item) return false;
      if (unit && line.unit && unit !== line.unit) return false;
      if (destination && line.destination && destination !== line.destination) return false;
      if (code && line.code) return code === line.code;
      return !material || !line.material || material === line.material;
    });
    const exact = item ? matches.filter((line) => line.item === item) : [];
    const candidates = exact.length ? exact : matches;
    if (candidates.length !== 1 && !exact.length) continue;
    for (const line of candidates) {
      const alreadyMatched = transitByRow.get(line.row) || 0;
      const allocated = Math.min(amount, line.quantity - alreadyMatched);
      transitByRow.set(line.row, alreadyMatched + allocated);
      amount -= allocated;
      if (amount <= 0) break;
    }
  }
  return transitByRow;
}

const webLotHeaders = ["Lote Bravo", "Lote Web", "Lote"];
const webProductHeaders = ["Descrição Produto", "Insumo Web", "Produto Web", "Material Web", "Produto"];

export function indexLogisticsLots(webStock: OperationalRow[], sapStock: OperationalRow[]) {
  const pairs = new Map<string, string[]>();
  for (const row of webStock) {
    const lot = sapIdentifier(readText(row, ...webLotHeaders));
    const product = normalizeMaterial(readText(row, ...webProductHeaders));
    const sapLot = readText(row, "Lote SAP", "Lote indústria");
    if (!lot || !product || !sapLot) continue;
    const key = `${lot}|${product}`;
    pairs.set(key, [...(pairs.get(key) || []), sapLot]);
  }
  const stock = new Map<string, Array<{ lot: string; product: string; code: string; center: string }>>();
  for (const row of sapStock) {
    const lot = readText(row, ...sapLotHeaders);
    if (!lot) continue;
    const key = sapIdentifier(lot);
    const lines = stock.get(key) || [];
    lines.push({
      lot, product: readText(row, "Texto breve material", "Descrição material", "Insumo", "Produto"),
      code: readText(row, "Material", "CD MAT", "Código material"),
      center: readText(row, "Centro", "CEN"),
    });
    stock.set(key, lines);
  }
  return (line: {
    lot: string; product: string; sapLot?: string; sapCode?: string; sapProduct?: string; center?: string;
  }, item: {
    product: string; productCode: string; standardProduct?: string; requestProduct?: string; adjustmentRequired?: boolean;
  }) => {
    const lotKey = sapIdentifier(line.lot);
    const explicitLots = pairs.get(`${lotKey}|${normalizeMaterial(line.product)}`) || [];
    const pairedLots = [...new Set(explicitLots)];
    const explicit = line.sapLot || (pairedLots.length === 1 ? pairedLots[0] : "");
    const code = sapIdentifier(line.sapCode || item.productCode);
    const names = new Set([line.sapProduct, item.product, item.standardProduct, !item.adjustmentRequired ? item.requestProduct : ""]
      .map(normalizeMaterial).filter(Boolean));
    const center = sapIdentifier(line.center || "");
    const stockMatches = (key: string) => (stock.get(key) || []).filter((entry) =>
      ((code && sapIdentifier(entry.code) === code) || names.has(normalizeMaterial(entry.product))) &&
      (!center || !entry.center || center === sapIdentifier(entry.center)),
    );
    const exact = stockMatches(explicit ? sapIdentifier(explicit) : lotKey);
    // Alguns lotes formatados pela Bravo terminam com um zero a mais. A
    // grafia alternativa precisa existir no estoque SAP do mesmo material.
    const matches = !explicit && !exact.length && /^\d+-\d+-\d+0$/.test(line.lot)
      ? stockMatches(lotKey.slice(0, -1))
      : exact;
    const only = (values: string[]) => {
      const distinct = [...new Set(values.filter(Boolean))];
      return distinct.length === 1 ? distinct[0] : "";
    };
    return {
      sapLot: explicit || (pairedLots.length > 1 ? "" : only(matches.map((entry) => entry.lot))),
      sapProduct: line.sapProduct || only(matches.map((entry) => entry.product)) || (!item.adjustmentRequired ? item.requestProduct : "") || item.product,
      sapCode: line.sapCode || only(matches.map((entry) => entry.code)) || item.productCode,
      center: line.center || only(matches.map((entry) => entry.center)),
    };
  };
}
