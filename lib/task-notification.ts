import { normalizeMaterial } from "@/lib/material-dimension";
import { logisticsUnit, sapIdentifier } from "@/lib/logistics-sap";
import { headerKey, quantityFor, readPendingOrderDetails, readText, type OperationalRow } from "@/lib/reconciliation";
import { sapOrderHeaders, sapTransitDestinationHeaders, sapTransitSupplierHeaders, sapUnitHeaders } from "@/lib/sap-logistics-fields.mjs";

type PendingEmailOrder = { reference: string; physicalMaterial: string; nucleus: string; row: OperationalRow; dueDate: Date | null };
type OrderMaterial = { code: string; material: string };
type OrderLine = OrderMaterial & ReturnType<typeof readPendingOrderDetails>;

type OrderEmailRow = {
  dueDate: Date | null;
  reference: string;
  item: string;
  material: string;
  nucleus: string;
  ordered: number | null;
  delivered: number | null;
  remaining: number | null;
  recordedQuantity: number | null;
};
type TransitNotificationRow = {
  center: string;
  reference: string;
  supplierCenter: string;
  material: string;
  quantity: number;
  unit: string;
};

const headers = ["DATA PED", "PEDIDO", "ITEM PED", "INSUMO", "QTD PEDIDO", "QTD ENTREGUE", "FALTA ENTREGAR"];
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const volumeFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const missingValue = "—";
const encoder = new TextEncoder();

function orderMaterialCode(row: OperationalRow) {
  return sapIdentifier(readText(row, "Código material", "Código do material", "MAT", "Material"));
}

function indexOrderLines(rows: OperationalRow[], candidateReferences: Set<string>) {
  const orders = new Map<string, OrderLine[]>();
  for (const row of rows) {
    if (["SIM", "S", "X", "TRUE"].includes(headerKey(readText(row, "Eliminado?", "Eliminado", "Cancelado")))) continue;
    const reference = sapIdentifier(readText(row, "Doc.compra", "Documento de compra", "Documento de compras", "Pedido", "Nº pedido", "Documento"));
    if (!reference || !candidateReferences.has(reference)) continue;
    const lines = orders.get(reference) ?? [];
    lines.push({
      ...readPendingOrderDetails(row),
      code: orderMaterialCode(row),
      material: normalizeMaterial(readText(row, "Descrição Material", "Texto breve material", "Texto material", "Produto", "Insumo")),
    });
    orders.set(reference, lines);
  }
  return orders;
}

function matchOrderLine(lines: OrderLine[], sameOrder: OrderMaterial[], item: string, { code, material }: OrderMaterial) {
  if (!lines.length) return undefined;
  // Em cargas antigas sem item, o produto deve identificar uma única linha em ambas as bases.
  const codeMatches = code && sameOrder.filter((line) => line.code === code).length === 1
    ? lines.filter((line) => line.code === code) : [];
  const matches = item ? lines.filter((line) => sapIdentifier(line.item) === item)
    : codeMatches.length ? codeMatches
      : material && material !== "SEMDESCRICAO" && sameOrder.filter((line) => line.material === material).length === 1
        ? lines.filter((line) => line.material === material && (!code || !line.code || line.code === code)) : [];
  return matches.length === 1 && (!code || !matches[0].code || matches[0].code === code) ? matches[0] : undefined;
}

export function resolveTaskNotificationOrders(
  candidates: PendingEmailOrder[],
  pending: PendingEmailOrder[],
  purchases: OperationalRow[],
  supplementalRows: OperationalRow[] = [],
): OrderEmailRow[] {
  const candidateReferences = new Set(candidates.map((signal) => sapIdentifier(signal.reference)));
  const orders = indexOrderLines(purchases, candidateReferences);
  const supplementalOrders = indexOrderLines(supplementalRows, candidateReferences);
  const pendingReferences = new Map<string, OrderMaterial[]>();
  for (const signal of pending) {
    const reference = sapIdentifier(signal.reference);
    if (!orders.has(reference) && !supplementalOrders.has(reference)) continue;
    const lines = pendingReferences.get(reference) ?? [];
    lines.push({ code: orderMaterialCode(signal.row), material: normalizeMaterial(signal.physicalMaterial) });
    pendingReferences.set(reference, lines);
  }

  return candidates.flatMap((signal) => {
    const details = readPendingOrderDetails(signal.row);
    const reference = sapIdentifier(signal.reference);
    const sameOrder = pendingReferences.get(reference) ?? [];
    const product = { code: orderMaterialCode(signal.row), material: normalizeMaterial(signal.physicalMaterial) };
    const supplement = matchOrderLine(supplementalOrders.get(reference) ?? [], sameOrder, sapIdentifier(details.item), product);
    const supplementalQuantities = supplement && (["ordered", "delivered", "remaining"] as const).every((field) =>
      details[field] === null || supplement[field] === null || details[field] === supplement[field],
    ) ? supplement : undefined;
    const item = details.item || supplement?.item || "";
    const matched = matchOrderLine(orders.get(reference) ?? [], sameOrder, sapIdentifier(item), product);
    const ordered = details.ordered ?? supplementalQuantities?.ordered ?? matched?.ordered ?? null;
    let delivered = details.delivered ?? supplementalQuantities?.delivered ?? matched?.delivered ?? null;
    let remaining = details.remaining ?? supplementalQuantities?.remaining ?? matched?.remaining ?? null;
    if (details.remaining !== null && details.delivered === null && ordered !== null) {
      delivered = ordered >= details.remaining ? ordered - details.remaining : null;
    } else if (details.ordered !== null && details.remaining === null && delivered !== null) {
      remaining = Math.max(0, details.ordered - delivered);
    }
    if (remaining !== null && remaining <= 0) return [];
    return [{
      dueDate: signal.dueDate,
      reference: signal.reference,
      item: item || matched?.item || "",
      material: signal.physicalMaterial,
      nucleus: signal.nucleus,
      ordered,
      delivered,
      remaining,
      recordedQuantity: ordered === null && remaining === null ? details.recordedQuantity : null,
    }];
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

export function buildTaskNotification(nucleus: string, minimumDays: number, rows: OrderEmailRow[]) {
  const subject = `Controle de pedidos de produtos - ${nucleus === "Todos" ? "Todos os núcleos" : nucleus}`;
  const days = minimumDays === 1 ? "1 dia" : `${minimumDays} dias`;
  const request = "Favor verificar os pedidos abaixo, pendentes no sistema";
  const instruction = "Se o produto já foi entregue por outro pedido (por exemplo, por transferência ou entrega direta) e não for necessário volume adicional, favor excluir a linha do pedido.";
  const partialDelivery = "Em caso de entrega parcial, ajuste a linha do pedido para a quantidade entregue se o volume restante não for necessário.";
  const showRecordedQuantity = rows.some((row) => row.recordedQuantity !== null);
  const columns = [...headers, ...(showRecordedQuantity ? ["QTD NA BASE"] : []), ...(nucleus === "Todos" ? ["NÚCLEO"] : [])];
  const formatVolume = (value: number | null) => value === null ? missingValue : volumeFormat.format(value);
  const cells = rows.map((row) => {
    const fields = [
      row.dueDate ? dateFormat.format(row.dueDate) : missingValue, row.reference, row.item || missingValue, row.material,
      formatVolume(row.ordered), formatVolume(row.delivered), formatVolume(row.remaining),
    ];
    if (showRecordedQuantity) fields.push(row.recordedQuantity === null ? "" : formatVolume(row.recordedQuantity));
    if (nucleus === "Todos") fields.push(row.nucleus);
    return fields;
  });
  const incompleteRows = cells.filter((row) => row.slice(0, headers.length).includes(missingValue)).length;
  const missingNote = incompleteRows ? "O traço (—) indica um campo indisponível na base." : "";
  const volumeNote = showRecordedQuantity ? "Qtd na base mostra o volume preservado na importação antiga, que pode ser a quantidade pedida ou o saldo a entregar." : "";

  const tableHeader = columns.map((label) => `<th scope="col" bgcolor="#438d21" style="color:#fff;background:#438d21;text-align:left;padding:4px 6px;white-space:nowrap">${label}</th>`).join("");
  const tableRows = cells.map((row) => `<tr>${row.map((value, index) => {
    const align = index >= 4 && columns[index] !== "NÚCLEO" ? "right" : "left";
    const dateCell = index === 0 ? ' bgcolor="#e2f2d9"' : "";
    const weight = index <= 1 ? "font-weight:bold;" : "";
    return `<td${dateCell} style="padding:4px 6px;border-bottom:1px solid #e7ebdf;text-align:${align};${weight}">${escapeHtml(value)}</td>`;
  }).join("")}</tr>`).join("");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:14px;color:#1a1a1a">
    <p>Olá,</p>
    <p>${request}, com atraso de pelo menos <strong>${days}</strong> em relação à previsão de utilização.</p>
    <p>${instruction}</p>
    <p><strong>Observação:</strong> ${partialDelivery}</p>
    <table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:13px"><thead><tr>${tableHeader}</tr></thead><tbody>${tableRows}</tbody></table>
    ${missingNote ? `<p style="font-size:12px;color:#4b5563">${missingNote}</p>` : ""}
    ${volumeNote ? `<p style="font-size:12px;color:#4b5563">${volumeNote}</p>` : ""}
    <p><br></p>
  </body></html>`;
  const textTable = [columns, ...cells].map((row) => row.map((value) => value.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\r\n");
  const text = [
    "Olá,", `${request}, com atraso de pelo menos ${days} em relação à previsão de utilização.`,
    instruction, `Observação: ${partialDelivery}`, textTable, missingNote, volumeNote,
  ].filter(Boolean).join("\r\n\r\n") + "\r\n\r\n";
  return { subject, html, text, incompleteRows };
}

export function listTransitNotificationOrders(rows: OperationalRow[]) {
  const orders = new Map<string, TransitNotificationRow>();
  for (const row of rows) {
    const quantity = quantityFor(row, "transit");
    if (quantity <= 0 || ["SIM", "S", "X", "TRUE"].includes(headerKey(readText(row, "Eliminado?", "Cancelado")))) continue;
    const center = readText(row, ...sapTransitDestinationHeaders, "Cen.", "Centro");
    const reference = readText(row, ...sapOrderHeaders, "Documento");
    if (!center || !reference) continue;
    const supplierCenter = readText(row, ...sapTransitSupplierHeaders);
    const material = readText(row, "Texto breve material", "Descrição material", "Insumo", "Produto");
    const code = sapIdentifier(readText(row, "Material", "Código material", "MAT"));
    const unit = readText(row, ...sapUnitHeaders);
    const materialKey = code ? `codigo:${code}` : `descricao:${headerKey(material)}`;
    const key = [headerKey(center), sapIdentifier(reference), headerKey(supplierCenter), materialKey, logisticsUnit(unit)].join("|");
    const existing = orders.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.material ||= material;
    } else {
      orders.set(key, { center, reference, supplierCenter, material, quantity, unit });
    }
  }
  return [...orders.values()].sort((left, right) =>
    left.center.localeCompare(right.center, "pt-BR", { numeric: true }) ||
    left.reference.localeCompare(right.reference, "pt-BR", { numeric: true }) ||
    left.supplierCenter.localeCompare(right.supplierCenter, "pt-BR", { numeric: true }) ||
    left.material.localeCompare(right.material, "pt-BR") ||
    left.unit.localeCompare(right.unit, "pt-BR"),
  );
}

export const transitNotificationHeaders = ["Centro destino", "Pedido", "Centro fornecedor", "Material", "Quantidade"];

export function formatTransitNotificationCells(row: TransitNotificationRow) {
  return [
    row.center, row.reference, row.supplierCenter || missingValue, row.material || missingValue,
    row.unit ? `${volumeFormat.format(row.quantity)} ${row.unit}` : volumeFormat.format(row.quantity),
  ];
}

export function buildTransitNotification(center: string, rows: TransitNotificationRow[]) {
  const subject = `Pedidos em trânsito pendentes de aceite - ${center || "Todos os centros"}`;
  const intro = "Podem verificar o aceite no destino dos pedidos em trânsito listados abaixo?";
  const cells = rows.map(formatTransitNotificationCells);
  const incompleteRows = rows.filter((row) => !row.supplierCenter || !row.material).length;
  const missingNote = incompleteRows ? "O traço (—) indica um campo indisponível na MB5T importada." : "";
  const cellStyle = "border:1px solid #9cb8d0;padding:5px 10px;text-align:left;white-space:nowrap";
  const headings = transitNotificationHeaders.map((label) =>
    `<th scope="col" bgcolor="#367bb8" style="${cellStyle};color:#fff">${label}</th>`,
  ).join("");
  const body = cells.map((row) => `<tr>${row.map((value) =>
    `<td bgcolor="#e2f2fc" style="${cellStyle}">${escapeHtml(value)}</td>`,
  ).join("")}</tr>`).join("");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:14px;color:#1a1a1a">
    <p>Bom dia,</p>
    <p>${intro}</p>
    <table style="border-collapse:collapse"><thead><tr>${headings}</tr></thead><tbody>${body}</tbody></table>
    ${missingNote ? `<p style="font-size:12px;color:#4b5563">${missingNote}</p>` : ""}
    <p>Atenciosamente,</p><p><br></p>
  </body></html>`;
  const table = [transitNotificationHeaders, ...cells].map((row) =>
    row.map((value) => value.replace(/[\t\r\n]+/g, " ")).join("\t"),
  ).join("\r\n");
  const text = ["Bom dia,", intro, table, missingNote, "Atenciosamente,"].filter(Boolean).join("\r\n\r\n") + "\r\n\r\n";
  return { subject, html, text, incompleteRows, count: rows.length };
}

export function parseNotificationRecipients(value: string) {
  const addresses = [...new Set(value.split(/[;,\r\n]/).map((item) => item.trim()).filter(Boolean))];
  return addresses.every((address) => /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(address)) ? addresses : null;
}

function toBase64(value: string) {
  const bytes = encoder.encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function mimeSubject(subject: string) {
  const words: string[] = [];
  let part = "";
  let length = 0;
  for (const character of subject.replace(/[\r\n]/g, " ")) {
    const size = encoder.encode(character).length;
    if (length + size > 42) {
      words.push(`=?UTF-8?B?${toBase64(part)}?=`);
      part = "";
      length = 0;
    }
    part += character;
    length += size;
  }
  if (part) words.push(`=?UTF-8?B?${toBase64(part)}?=`);
  return words.join("\r\n ");
}

export function buildOutlookEml(email: Pick<ReturnType<typeof buildTaskNotification>, "subject" | "html" | "text">, to: string[], cc: string[]) {
  const boundary = "agronexus-task-notification";
  const lines = [
    "X-Unsent: 1",
    `To: ${to.join(",\r\n ")}`,
    ...(cc.length ? [`Cc: ${cc.join(",\r\n ")}`] : []),
    `Subject: ${mimeSubject(email.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
  ];
  for (const [type, body] of [["plain", email.text], ["html", email.html]]) {
    lines.push(
      `--${boundary}`,
      `Content-Type: text/${type}; charset=UTF-8`,
      "Content-Transfer-Encoding: base64",
      "",
      toBase64(body).match(/.{1,76}/g)?.join("\r\n") ?? "",
    );
  }
  return [...lines, `--${boundary}--`, ""].join("\r\n");
}

export function buildNotificationMailto(subject: string, to: string[], cc: string[]) {
  const recipients = to.map((address) => encodeURIComponent(address).replace(/%40/g, "@")).join(",");
  const copy = cc.length ? `&cc=${encodeURIComponent(cc.join(","))}` : "";
  return `mailto:${recipients}?subject=${encodeURIComponent(subject)}${copy}`;
}
