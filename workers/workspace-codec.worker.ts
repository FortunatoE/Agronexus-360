import { base64ToBytes } from "../lib/workspace-base64";

type CodecRequest = {
  action: "decode" | "encode";
  id: string;
  value: unknown;
};

function bytesToBase64(bytes: Uint8Array) {
  let output = "";
  for (let index = 0; index < bytes.length; index += 0x8000) output += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(output);
}

async function encode(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (!("CompressionStream" in self)) return { encoding: "json", data: value };
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return { encoding: "gzip-base64", data: bytesToBase64(compressed) };
}

async function decode(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const stored = value as { encoding?: string; data?: unknown };
  if (stored.encoding === "json") return stored.data || null;
  if (stored.encoding !== "gzip-base64" || typeof stored.data !== "string" || !("DecompressionStream" in self)) return null;
  const stream = new Blob([base64ToBytes(stored.data)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

self.onmessage = ({ data }: MessageEvent<CodecRequest>) => {
  void (async () => {
    try {
      const value = data.action === "encode" ? await encode(data.value) : await decode(data.value);
      self.postMessage({ id: data.id, value });
    } catch (error) {
      self.postMessage({ id: data.id, error: error instanceof Error ? error.message : "Não foi possível processar a base local." });
    }
  })();
};
