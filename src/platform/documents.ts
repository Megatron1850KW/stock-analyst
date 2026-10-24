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

/** Bytes de un PDF guardado (para la extracción de cifras con Claude). */
export async function readPdf(path: string): Promise<Uint8Array> {
  const raw = await invoke<ArrayBuffer | number[]>("document_read_pdf", { path });
  return raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw);
}

/** Informe Inline XBRL (.xhtml) de dentro de un ZIP ESEF guardado. */
export const readEsefReport = (path: string) => invoke<string>("document_esef_report", { path });
