import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

/** Respuesta del comando de Rust `document_store`. */
const storedSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  kind: z.enum(["pdf", "zip"]),
});
export type StoredDocument = z.infer<typeof storedSchema>;

export const ACCEPTED_FILES = ".pdf,.zip,application/pdf,application/zip";

/**
 * Guarda el archivo en la carpeta de datos de la app. Viaja en binario (no
 * como JSON) y el nombre va codificado para admitir tildes.
 */
export async function storeDocument(securityId: number, file: File): Promise<StoredDocument> {
  const data = new Uint8Array(await file.arrayBuffer());
  const raw = await invoke("document_store", data, {
    headers: { "x-security-id": String(securityId), "x-file-name": encodeURIComponent(file.name) },
  });
  const parsed = storedSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Respuesta inesperada al guardar el archivo");
  return parsed.data;
}

export const openDocument = (path: string) => invoke("document_open", { path });
export const deleteDocumentFile = (path: string) => invoke("document_delete", { path });
