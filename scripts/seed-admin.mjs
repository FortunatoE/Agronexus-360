import { createUser, ensureSchema, findUser, passwordRecord } from "../api/_core.js";
import { randomBytes } from "node:crypto";

const [username, displayName = "Emmanuel Fortunato"] = process.argv.slice(2);
const password = await new Promise((resolve) => {
  let value = "";
  const timeout = setTimeout(() => {
    throw new Error("Tempo esgotado ao aguardar a senha pela entrada padrão.");
  }, 120000);
  const isInteractive = Boolean(process.stdin.isTTY && process.stdin.setRawMode);
  if (isInteractive) process.stdin.setRawMode(true);

  const finish = () => {
    clearTimeout(timeout);
    process.stdin.off("data", onData);
    if (isInteractive) process.stdin.setRawMode(false);
    process.stdin.pause();
    resolve(value);
  };
  const onData = (chunk) => {
    const input = chunk.toString("utf8");
    if (input.includes("\u0003")) process.exit(130);
    const end = input.search(/[\r\n]/);
    const characters = end >= 0 ? input.slice(0, end) : input;
    for (const character of characters) {
      if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
      else value += character;
    }
    if (end >= 0) finish();
  };

  process.stdin.on("data", onData);
  process.stdin.resume();
});

if (!username || !password) throw new Error("Informe o login como argumento e a senha pela entrada padrão.");
await ensureSchema();
const existing = await findUser(username);
if (existing) {
  const { passwordHash, passwordSalt } = await passwordRecord(password);
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);
  await sql`UPDATE agronexus_users SET display_name = ${displayName}, role = 'admin', password_hash = ${passwordHash}, password_salt = ${passwordSalt} WHERE id = ${existing.id}`;
  console.log("Administrador atualizado.");
} else {
  await createUser({ username, name: displayName, password, role: "admin" });
  console.log("Administrador criado.");
}
