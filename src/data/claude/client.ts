import Anthropic from "@anthropic-ai/sdk";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

/**
 * Cliente de Claude (SDK oficial) cuyo `fetch` pasa por el comando de Rust
 * `claude_request`, que añade la clave guardada en el Llavero. La clave nunca
 * llega a este lado: `apiKey` es solo un marcador que Rust descarta.
 */

const rustResponse = z.object({
  status: z.number().int(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
});

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h).forEach((v, k) => (out[k] = v));
  return out;
}

export const tauriClaudeFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== "https://api.anthropic.com") throw new Error(`Destino no permitido: ${url.origin}`);
  if ((init?.method ?? "GET").toUpperCase() !== "POST") throw new Error("Solo se permiten peticiones POST a Claude");
  const body = typeof init?.body === "string" ? init.body : "";
  const raw = await invoke("claude_request", { path: url.pathname, headers: headersToRecord(init?.headers), body });
  const r = rustResponse.parse(raw);
  return new Response(r.body, { status: r.status, headers: r.headers });
};

export function createClaudeClient(fetchImpl: typeof fetch = tauriClaudeFetch): Anthropic {
  return new Anthropic({
    apiKey: "llavero",
    baseURL: "https://api.anthropic.com",
    fetch: fetchImpl,
    // El SDK corre en la vista web de Tauri; la clave real solo existe en Rust
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  });
}
