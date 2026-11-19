import { createUser, currentUser, deleteUser, listUsers, sendError, updateUser } from "./_core.js";

export default async function handler(request, response) {
  try {
    const user = await currentUser(request);
    if (!user) return sendError(response, 401, "Sessão expirada. Entre novamente.");
    if (user.role !== "admin") return sendError(response, 403, "Apenas administradores podem gerenciar usuários.");
    if (request.method === "GET") return response.status(200).json({ users: await listUsers() });
    if (request.method === "POST") {
      const { username, name, password, role, nucleus } = request.body || {};
      return response.status(201).json({ user: await createUser({ username, name, password, nucleus, role: role === "admin" ? "admin" : "viewer" }) });
    }
    if (request.method === "PATCH") {
      const { id, username, name, password, role, nucleus } = request.body || {};
      return response.status(200).json({ user: await updateUser({ id, username, name, password, nucleus, role }) });
    }
    if (request.method === "DELETE") {
      await deleteUser(request.body?.id, user.id);
      return response.status(200).json({ ok: true });
    }
    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return sendError(response, 405, "Método não permitido.");
  } catch (error) {
    console.error("User management failure", error);
    return sendError(response, 500, error instanceof Error ? error.message : "Não foi possível acessar usuários.");
  }
}
