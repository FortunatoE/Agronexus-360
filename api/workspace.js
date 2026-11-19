import { gunzipSync, gzipSync } from "node:zlib";
import { legacyCommercialClosings } from "./legacy-commercial-closings.js";
import { currentUser, readWorkspace, sendError, writeWorkspace } from "./_core.js";

function decodePayload(payload) {
  if (payload?.encoding === "gzip-base64" && typeof payload.data === "string") return JSON.parse(gunzipSync(Buffer.from(payload.data, "base64url")).toString("utf8"));
  return payload?.encoding === "json" ? payload.data : payload;
}

function encodedPayload(workspace) {
  return { encoding: "gzip-base64", data: gzipSync(JSON.stringify(workspace)).toString("base64url"), version: 2 };
}

function seedLegacyCommercialClosings(payload) {
  const workspace = decodePayload(payload);
  if (!workspace || typeof workspace !== "object") return { changed: false, payload };
  const existing = Array.isArray(workspace.commercialClosings?.closings) ? workspace.commercialClosings.closings : [];
  if (existing.some((closing) => String(closing?.id || "").startsWith("legado-fechamento-26-27-"))) return { changed: false, payload };
  return {
    changed: true,
    payload: encodedPayload({
      ...workspace,
      commercialClosings: {
        ...(workspace.commercialClosings || {}),
        annotations: Array.isArray(workspace.commercialClosings?.annotations) ? workspace.commercialClosings.annotations : [],
        closings: [...legacyCommercialClosings, ...existing],
      },
    }),
  };
}

export default async function handler(request, response) {
  try {
    const user = await currentUser(request);
    if (!user) return sendError(response, 401, "Sessão expirada. Entre novamente.");
    if (request.method === "GET") {
      let workspace = await readWorkspace(user.id);
      // A carga é única e é aplicada pela base central, sem expor uma nova
      // opção de importação. A interface de fechamentos continua restrita
      // ao perfil administrador.
      if (workspace?.payload) {
        const seeded = seedLegacyCommercialClosings(workspace.payload);
        if (seeded.changed) {
          const saved = await writeWorkspace(user.id, seeded.payload);
          workspace = { ...workspace, payload: seeded.payload, updatedAt: saved.updatedAt };
        }
      }
      return response.status(200).json({ workspace: workspace?.payload || null, updatedAt: workspace?.updatedAt || null });
    }
    if (request.method === "PUT") {
      const payload = request.body?.payload;
      if (!payload || typeof payload !== "object") return sendError(response, 400, "Carga inválida.");
      const saved = await writeWorkspace(user.id, payload);
      return response.status(200).json({ ok: true, updatedAt: saved.updatedAt });
    }
    response.setHeader("Allow", "GET, PUT");
    return sendError(response, 405, "Método não permitido.");
  } catch (error) {
    console.error("Workspace failure", error);
    return sendError(response, 500, "Não foi possível acessar a carga central.");
  }
}
