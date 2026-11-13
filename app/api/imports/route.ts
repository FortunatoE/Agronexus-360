import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { getDb } from "@/db";
import { importFiles, importVersions } from "@/db/schema";

const sources = [
  { key: "planejamento", header: 0 },
  { key: "execucao", header: 1 },
  { key: "consumo", header: 3 },
  { key: "estoque", header: 1 },
  { key: "transito", header: 1 },
] as const;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(request: Request) {
  if (!env.BUCKET) return json({ error: "Armazenamento de arquivos indisponível." }, 503);

  const form = await request.formData();
  const files = sources.map((source) => ({ source, file: form.get(`file-${source.key}`) }));
  const invalid = files.find(({ file }) => !(file instanceof File) || !/\.xls(x)?$/i.test(file.name));
  if (invalid) return json({ error: "Envie os cinco arquivos Excel esperados para a importação." }, 400);

  const db = getDb();
  const versionId = crypto.randomUUID();
  await db.insert(importVersions).values({
    id: versionId,
    status: "uploading",
    validationSummary: JSON.stringify({ requiredSources: sources.map(({ key }) => key) }),
  });

  try {
    const summaries: Array<{ source: string; fileName: string; rows: number; sheets: string[] }> = [];
    for (const { source, file } of files) {
      const uploaded = file as File;
      const bytes = new Uint8Array(await uploaded.arrayBuffer());
      const workbook = XLSX.read(bytes, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { range: source.header, defval: "" }).length;
      const objectKey = `imports/${versionId}/${source.key}/${safeFileName(uploaded.name)}`;

      await env.BUCKET.put(objectKey, bytes, {
        httpMetadata: { contentType: uploaded.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        customMetadata: { source: source.key, versionId, originalName: uploaded.name },
      });
      await db.insert(importFiles).values({
        id: crypto.randomUUID(),
        versionId,
        source: source.key,
        originalName: uploaded.name,
        objectKey,
        rowCount: rows,
        status: "stored",
      });
      summaries.push({ source: source.key, fileName: uploaded.name, rows, sheets: workbook.SheetNames });
    }

    await db.update(importVersions).set({ status: "validated", validationSummary: JSON.stringify({ files: summaries }) }).where(eq(importVersions.id, versionId));
    return json({ versionId, status: "validated", files: summaries }, 201);
  } catch (error) {
    await db.update(importVersions).set({ status: "failed", validationSummary: JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }) }).where(eq(importVersions.id, versionId));
    return json({ error: "Não foi possível armazenar e validar a versão da importação." }, 500);
  }
}
