import { findUser } from "../api/_core.js";

const user = await findUser(process.argv[2]);
console.log(user?.role === "admin" ? "Administrador central registrado." : "Administrador não encontrado.");
