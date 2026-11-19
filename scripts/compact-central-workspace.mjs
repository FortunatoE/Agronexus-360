import { readWorkspace } from "../api/_core.js";

const workspace = await readWorkspace();
const datasets = Object.fromEntries(Object.entries(workspace?.payload?.data?.datasets || {}).map(([source, rows]) => [source, Array.isArray(rows) ? rows.length : 0]));
console.log(JSON.stringify({ compacted: Boolean(workspace), datasets }));
