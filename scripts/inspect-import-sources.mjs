import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
for (const file of files) {
  const workbook = XLSX.read(readFileSync(file), { type: "buffer", cellDates: true });
  const report = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    return {
      sheet: sheetName,
      dimensions: sheet["!ref"] || "",
      preview: rows.slice(0, 8),
      nonEmptyRows: rows.filter((row) => row.some((value) => String(value).trim())).length,
    };
  });
  console.log(JSON.stringify({ file, report }, null, 2));
}
