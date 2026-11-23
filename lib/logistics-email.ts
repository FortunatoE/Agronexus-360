export type LogisticsEmailKind = "faturamento" | "bravo";

export type LogisticsEmailRow = {
  center: string;
  sapCode: string;
  sapProduct: string;
  sapLot: string;
  webProduct: string;
  webLot: string;
  unit: string;
  quantity: number;
  destination: string;
  destinationCode: string;
  request: string;
  invoice: string;
  responsible: string;
  warehouse: string;
};

const volumeFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const escape = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character,
);

export function buildLogisticsEmail(kind: LogisticsEmailKind, rows: LogisticsEmailRow[], trip: {
  driver: string; plate: string; date: string; reference: string; appointment: string;
}) {
  const billing = kind === "faturamento";
  const driver = trip.driver.trim().split(/\s+/)[0].toLocaleUpperCase("pt-BR");
  const [, month, day] = trip.date.split("-");
  const warehouses = [...new Set(rows.map((row) => row.warehouse).filter(Boolean))].join(" / ");
  const appointment = trip.appointment ? `AGENDAMENTO ${trip.appointment}` : `ROTA ${trip.reference}`;
  const subject = billing
    ? [`CARREGAMENTO ${driver} ${day && month ? `${day}/${month}` : ""}`.trim(), warehouses].filter(Boolean).join(" - ").toLocaleUpperCase("pt-BR")
    : appointment;
  const intro = billing
    ? "Bom dia, por gentileza, gerem o estoque dos produtos abaixo."
    : `Boa tarde, seguem as solicitações e notas referentes ao ${appointment.toLocaleLowerCase("pt-BR")}.`;
  const headers = [
    "CEN", ...(billing ? ["CD MAT", "INSUMO SAP", "LOTE SAP"] : ["INSUMO WEB", "LOTE WEB"]),
    "UMB", "QTD", "DESTINO", "LOCAL DESTINO", "MOTORISTA", "PLACA",
    "SOLICITAÇÃO", "AGENDAMENTO", "NOTA FISCAL", "AG",
  ];
  const groups = new Map<string, string[][]>();
  for (const row of rows) {
    const key = row.destinationCode || row.destination;
    const values = groups.get(key) || [];
    values.push([
      row.center, ...(billing ? [row.sapCode, row.sapProduct, row.sapLot] : [row.webProduct, row.webLot]),
      row.unit, volumeFormat.format(row.quantity), row.destinationCode, row.destination, trip.driver, trip.plate,
      row.request, trip.appointment, row.invoice, row.responsible,
    ]);
    groups.set(key, values);
  }
  const emphasis = new Set(["LOTE SAP", "LOTE WEB", "QTD", "DESTINO", "MOTORISTA", "SOLICITAÇÃO", "NOTA FISCAL"]);
  const head = headers.map((label) => {
    const highlighted = emphasis.has(label);
    return `<th scope="col" bgcolor="${highlighted ? "#20365d" : "#e5e7eb"}" style="border:1px solid #c3c8d0;padding:4px 6px;text-align:left;color:${highlighted ? "#fff" : "#152031"};white-space:nowrap">${label}</th>`;
  }).join("");
  const tables = [...groups.values()].map((values) => {
    const body = values.map((cells) => `<tr>${cells.map((cell, index) =>
      `<td${emphasis.has(headers[index]) ? ' bgcolor="#e4ebf7"' : ""} style="border:1px solid #c3c8d0;padding:3px 6px${headers[index] === "QTD" ? ";text-align:right" : ""}">${escape(cell)}</td>`,
    ).join("")}</tr>`).join("");
    return `<table style="margin:0 0 16px;border-collapse:collapse;font-size:12px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }).join("<br>");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;color:#152031;font-size:14px"><p>${escape(intro)}</p>${tables}<p>Atenciosamente,</p><p><br></p></body></html>`;
  const blocks = [...groups.values()].map((values) => [headers, ...values]
    .map((cells) => cells.map((cell) => cell.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\r\n"));
  return { subject, html, text: [intro, ...blocks, "Atenciosamente,"].join("\r\n\r\n") + "\r\n\r\n" };
}
