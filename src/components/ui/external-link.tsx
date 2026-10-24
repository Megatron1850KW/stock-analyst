import { openUrl } from "@tauri-apps/plugin-opener";
import type { AnchorHTMLAttributes } from "react";
import { inDesktopApp } from "@/platform/runtime";

/** Enlace a una web externa: en la app de escritorio se abre en tu navegador (la ventana de la app no navega fuera). */
export function ExternalLink({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string | undefined }) {
  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        onClick?.(e);
        if (inDesktopApp && href && /^https:\/\//.test(href)) {
          e.preventDefault();
          void openUrl(href);
        }
      }}
    />
  );
}
