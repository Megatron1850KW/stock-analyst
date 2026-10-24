import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { inDesktopApp } from "./runtime";

/** Inicio automático al arrancar sesión en macOS (LaunchAgent). */
export async function setAutostart(on: boolean): Promise<void> {
  if (!inDesktopApp) return;
  if (on === (await isEnabled())) return;
  await (on ? enable() : disable());
}
