export function base64ToBytes(value: string) {
  // A API grava Base64URL e o navegador também pode gravar Base64 padrão.
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
