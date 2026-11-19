import { neon } from "@neondatabase/serverless";
import { gunzipSync } from "node:zlib";

const aliases = [
  "Status", "Situação", "Situacao", "Classificação", "Classificacao", "Classificac�o", "Tipo",
  "Produto", "Material planejado", "Produto planejado", "Texto material", "Descrição material", "Descricao material", "Texto breve material", "INSUMO", "Produto solicitado", "Material solicitado",
  "Qtde. talhão", "Qtde talhão", "Volume ajustado (produto) padrão", "Volume ajustado (produto) padrao", "Quantidade", "Utilização livre", "Utiliza��o livre", "Utilizacao livre", "Saldo ajustado", "Estoque", "Qtd.retirada", "Qtd retirada", "Saldo Forn", "Saldo fornecedor", "Qtd.pedido", "Qtd pedido", "Volume solicitado",
  "Material", "Código material", "Codigo material", "MAT", "WBS element", "WBS", "Elemento PEP", "Elemento WBS", "Def.proj.", "Def proj", "Projeto", "Cen.", "Centro", "CEN", "Talhao", "Talhão", "Cultura", "Cultura 1", "Ciclo Plantio", "Ciclo", "Nucleo", "Núcleo", "Dep.", "Depósito", "Deposito", "DEP", "Nome Est.Esp.", "Nome Est Esp", "Armazém", "Armazem", "Local Est.Esp.", "Local Est Esp", "Cidade",
  "DiagRede", "Diagrama", "Tar.", "Operação", "Operacao", "Área executar (HA)", "Area executar (HA)", "HA_plantio", "HA plantio", "HA_talhao", "HA talhão", "Área Executada", "Area Executada", "Qtde. executada", "Data de plantio", "Data Plantio", "Dt. Plantio", "Dt Plantio", "DT_Plantio", "DATA_PLANTIO", "Plantio", "Qtd.necess.", "Qtd necess.", "Quantidade necessária", "Quantidade necessaria", "DT_Aplicacao", "Data prevista", "Data planejada", "Data aplicação", "Data", "DtRemPed", "Dt. Rem. Ped", "Data remessa", "Previsão de utilização", "Previsao de utilizacao", "Pedido", "Nº pedido", "No pedido", "Documento", "Doc. compra", "Solicitação", "Solicitacao", "Dt. Validade", "Dt Validade", "Data de validade", "Data Validade", "Validade", "Valor total", "Valor Total", "Valor", "Val. total", "Valor estoque", "Eliminado?", "Eliminado", "Cancelado",
];
const key = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\uFFFD/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const fields = aliases.map(key);
const compact = (row) => Object.fromEntries(Object.entries(row).filter(([header]) => {
  const current = key(header);
  return fields.some((field) => current === field || (field.length > 7 && current.startsWith(field)));
}));
const sql = neon(process.env.DATABASE_URL);
const [stored] = await sql`SELECT payload FROM agronexus_platform_workspace WHERE workspace_key = 'operacional'`;
const workspace = stored.payload.encoding === "gzip-base64" ? JSON.parse(gunzipSync(Buffer.from(stored.payload.data, "base64url")).toString("utf8")) : stored.payload.data;
const compacted = { ...workspace, datasets: Object.fromEntries(Object.entries(workspace.datasets).map(([source, rows]) => [source, rows.map(compact)])) };
console.log(JSON.stringify({ before: JSON.stringify(workspace).length, after: JSON.stringify(compacted).length, fields: Object.fromEntries(Object.entries(compacted.datasets).map(([key, rows]) => [key, Object.keys(rows[0] || {}).length])) }));
