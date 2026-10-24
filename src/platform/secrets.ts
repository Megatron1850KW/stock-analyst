import { invoke } from "@tauri-apps/api/core";
import type { SecretKeyId } from "@/features/settings/schema";
import { inDesktopApp } from "./runtime";

/**
 * Acceso al Llavero de macOS a través de comandos de Rust. El frontend puede
 * guardar, comprobar y borrar una clave, pero nunca leerla.
 */
export interface SecretStore {
  has(id: SecretKeyId): Promise<boolean>;
  set(id: SecretKeyId, value: string): Promise<void>;
  remove(id: SecretKeyId): Promise<void>;
}

const keychain: SecretStore = {
  has: (id) => invoke<boolean>("secret_exists", { name: id }),
  set: (id, value) => invoke("secret_set", { name: id, value }),
  remove: (id) => invoke("secret_delete", { name: id }),
};

// Solo para la vista previa en navegador: memoria volátil, nunca persiste.
const previewValues = new Set<SecretKeyId>();
const previewStore: SecretStore = {
  has: async (id) => previewValues.has(id),
  set: async (id, value) => {
    if (!value.trim()) throw new Error("La clave está vacía");
    previewValues.add(id);
  },
  remove: async (id) => {
    previewValues.delete(id);
  },
};

export const secrets: SecretStore = inDesktopApp ? keychain : previewStore;
