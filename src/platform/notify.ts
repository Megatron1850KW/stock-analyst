import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { inDesktopApp } from "./runtime";

/** Notificación de macOS. La primera vez macOS pide permiso; si lo deniegas, no se insiste. */
export async function notify(title: string, body: string): Promise<boolean> {
  if (!inDesktopApp) return false;
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === "granted";
  if (ok) sendNotification({ title, body });
  return ok;
}
