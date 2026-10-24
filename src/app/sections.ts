import { CandlestickChart, Eye, Settings, Star, WalletCards, type LucideIcon } from "lucide-react";

export interface Section {
  path: string;
  label: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  shortcut: string;
}

/** Las 4 secciones de la app (CLAUDE.md §5) más Ajustes. */
export const SECTIONS: Section[] = [
  {
    path: "/watchlist",
    label: "Watchlist",
    title: "Equity Analyst",
    subtitle: "Las acciones que sigues, con su análisis fundamental resumido.",
    icon: Eye,
    shortcut: "1",
  },
  {
    path: "/portfolio",
    label: "Mi Portfolio",
    title: "Mi Portfolio",
    subtitle: "Tus posiciones reales, su rentabilidad en euros y qué hacer con cada una.",
    icon: WalletCards,
    shortcut: "2",
  },
  {
    path: "/riesgo-tecnico",
    label: "Riesgo técnico",
    title: "Riesgo técnico de largo plazo",
    subtitle: "Tendencia de fondo, caídas y volatilidad en velas mensuales y semanales.",
    icon: CandlestickChart,
    shortcut: "3",
  },
  {
    path: "/estrellas",
    label: "Estrellas",
    title: "Estrellas",
    subtitle: "La mejor siguiente compra y la posición más barata hoy, con sus motivos.",
    icon: Star,
    shortcut: "4",
  },
];

export const SETTINGS_SECTION: Section = {
  path: "/ajustes",
  label: "Ajustes",
  title: "Ajustes",
  subtitle: "Claves, inteligencia artificial, datos de mercado y preferencias.",
  icon: Settings,
  shortcut: ",",
};
