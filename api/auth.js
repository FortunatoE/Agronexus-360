import { clearSession, createSession, currentUser, findUser, passwordMatches, publicUser, sendError } from "./_core.js";

export default async function handler(request, response) {
  try {
    if (request.method === "GET") return response.status(200).json({ user: await currentUser(request) });
    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      return sendError(response, 405, "Método não permitido.");
    }
    if (request.body?.action === "logout") {
      await clearSession(request, response);
      return response.status(200).json({ ok: true });
    }
    const username = String(request.body?.username || "");
    const password = String(request.body?.password || "");
    if (!username || !password) return sendError(response, 400, "Informe login e senha.");
    const user = await findUser(username);
    if (!user || !(await passwordMatches(password, user))) return sendError(response, 401, "Login ou senha inválidos.");
    await createSession(response, user.id);
    return response.status(200).json({ user: publicUser(user) });
  } catch (error) {
    console.error("Authentication failure", error);
    return sendError(response, 500, "Não foi possível concluir a autenticação.");
  }
}
