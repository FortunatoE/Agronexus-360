type OrderEmailRow = {
  orderDate: string;
  reference: string;
  item: string;
  material: string;
  nucleus: string;
  ordered: number | null;
  delivered: number | null;
  remaining: number | null;
};

const headers = ["DATA PED", "PEDIDO", "ITEM PED", "INSUMO", "QTD PEDIDO", "QTD ENTREGUE", "FALTA ENTREGAR"];
const volumeFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const missingValue = "—";
const encoder = new TextEncoder();

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
  const columns = nucleus === "Todos" ? [...headers, "NÚCLEO"] : headers;
  const formatVolume = (value: number | null) => value === null ? missingValue : volumeFormat.format(value);
  const cells = rows.map((row) => {
    const fields = [
      row.orderDate || missingValue, row.reference, row.item || missingValue, row.material,
      formatVolume(row.ordered), formatVolume(row.delivered), formatVolume(row.remaining),
    ];
    return nucleus === "Todos" ? [...fields, row.nucleus] : fields;
  });
  const missingNote = cells.some((row) => row.includes(missingValue)) ? "O traço (—) indica um campo indisponível na base." : "";

  const tableHeader = columns.map((label) => `<th scope="col" bgcolor="#438d21" style="color:#fff;background:#438d21;text-align:left;padding:4px 6px;white-space:nowrap">${label}</th>`).join("");
  const tableRows = cells.map((row) => `<tr>${row.map((value, index) => {
    const align = index >= 4 && index <= 6 ? "right" : "left";
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
  </body></html>`;
  const textTable = [columns, ...cells].map((row) => row.map((value) => value.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\r\n");
  const text = [
    "Olá,", `${request}, com atraso de pelo menos ${days} em relação à previsão de utilização.`,
    instruction, `Observação: ${partialDelivery}`, textTable, missingNote,
  ].filter(Boolean).join("\r\n\r\n");
  return { subject, html, text };
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
