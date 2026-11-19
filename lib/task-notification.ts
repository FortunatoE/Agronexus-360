import { normalizeMaterial } from "@/lib/material-dimension";
import { headerKey, readPendingOrderDetails, readText, type OperationalRow } from "@/lib/reconciliation";

type PendingEmailOrder = { reference: string; physicalMaterial: string; nucleus: string; row: OperationalRow; dueDate: Date | null };

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

const headers = ["DATA PED", "PEDIDO", "ITEM PED", "INSUMO", "QTD PEDIDO", "QTD ENTREGUE", "FALTA ENTREGAR"];
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const volumeFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const missingValue = "—";
const encoder = new TextEncoder();

function sapIdentifier(value: string) {
  const key = normalizeMaterial(value);
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "") : key;
}

function orderMaterialCode(row: OperationalRow) {
  return sapIdentifier(readText(row, "Código material", "Código do material", "MAT", "Material"));
}

export function resolveTaskNotificationOrders(
  candidates: PendingEmailOrder[],
  pending: PendingEmailOrder[],
  purchases: OperationalRow[],
): OrderEmailRow[] {
  const candidateReferences = new Set(candidates.map((signal) => sapIdentifier(signal.reference)));
  const orders = new Map<string, Array<ReturnType<typeof readPendingOrderDetails> & { code: string; material: string }>>();
  for (const purchase of purchases) {
    if (["SIM", "S", "X", "TRUE"].includes(headerKey(readText(purchase, "Eliminado?", "Eliminado", "Cancelado")))) continue;
    const reference = sapIdentifier(readText(purchase, "Doc.compra", "Documento de compra", "Documento de compras", "Pedido", "Nº pedido", "Documento"));
    if (!reference || !candidateReferences.has(reference)) continue;
    const lines = orders.get(reference) ?? [];
    lines.push({
      ...readPendingOrderDetails(purchase),
      code: orderMaterialCode(purchase),
      material: normalizeMaterial(readText(purchase, "Descrição Material", "Texto breve material", "Texto material", "Produto", "Insumo")),
    });
    orders.set(reference, lines);
  }

  const pendingReferences = new Map<string, Array<{ code: string; material: string }>>();
  for (const signal of pending) {
    const reference = sapIdentifier(signal.reference);
    if (!orders.has(reference)) continue;
    const lines = pendingReferences.get(reference) ?? [];
    lines.push({ code: orderMaterialCode(signal.row), material: normalizeMaterial(signal.physicalMaterial) });
    pendingReferences.set(reference, lines);
  }

  return candidates.flatMap((signal) => {
    const details = readPendingOrderDetails(signal.row);
    const reference = sapIdentifier(signal.reference);
    const lines = orders.get(reference) ?? [];
    const sameOrder = pendingReferences.get(reference) ?? [];
    const code = orderMaterialCode(signal.row);
    const material = normalizeMaterial(signal.physicalMaterial);
    const item = sapIdentifier(details.item);
    // O item identifica a linha. Para cargas antigas, código ou descrição só
    // resolvem a linha quando também são únicos na relação de pendências.
    const codeMatches = code && sameOrder.filter((line) => line.code === code).length === 1
      ? lines.filter((line) => line.code === code) : [];
    const matches = item ? lines.filter((line) => sapIdentifier(line.item) === item)
      : codeMatches.length ? codeMatches
        : material !== "SEMDESCRICAO" && sameOrder.filter((line) => line.material === material).length === 1
          ? lines.filter((line) => line.material === material && (!code || !line.code || line.code === code)) : [];
    const matched = matches.length === 1 && (!code || !matches[0].code || matches[0].code === code) ? matches[0] : undefined;
    const ordered = details.ordered ?? matched?.ordered ?? null;
    let delivered = details.delivered ?? matched?.delivered ?? null;
    let remaining = details.remaining ?? matched?.remaining ?? null;
    if (details.remaining !== null && details.delivered === null && ordered !== null) {
      delivered = ordered >= details.remaining ? ordered - details.remaining : null;
    } else if (details.ordered !== null && details.remaining === null && delivered !== null) {
      remaining = Math.max(0, details.ordered - delivered);
    }
    if (remaining !== null && remaining <= 0) return [];
    return [{
      dueDate: signal.dueDate,
      reference: signal.reference,
      item: details.item || matched?.item || "",
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

export function buildOutlookEml(email: ReturnType<typeof buildTaskNotification>, to: string[], cc: string[]) {
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
