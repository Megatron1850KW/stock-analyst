import { isTauri } from "@tauri-apps/api/core";

/**
 * true dentro de la app de escritorio. En el navegador (vista previa de
 * desarrollo y tests de UI) se usan sustitutos en memoria que no guardan nada.
 */
export const inDesktopApp: boolean = isTauri();
