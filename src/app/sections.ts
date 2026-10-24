import { CandlestickChart, Eye, Settings, Star, WalletCards, type LucideIcon } from "lucide-react";

export interface Section {
  path: string;
  label: string;
  title: string;
  subtitle: string;
  /** Texto corto para la columna de la portada. */
  blurb: string;
  /** Fase del plan en la que la sección empieza a funcionar. */
  phase: number;
  icon: LucideIcon;
  shortcut: string;
}

/** Última fase del plan (CLAUDE.md §11) ya construida. */
export const BUILT_PHASE = 10;

/** Las 4 secciones de la app (CLAUDE.md §5), en el orden de las columnas. */
export const SECTIONS: Section[] = [
  {
    path: "/watchlist",
    label: "Watchlist",
    title: "Equity Analyst",
    subtitle: "Las acciones que sigues, con su análisis fundamental resumido.",
    blurb: "Acciones que sigues, con su negocio, sus finanzas y si están caras o baratas.",
    phase: 2,
    icon: Eye,
    shortcut: "1",
  },
  {
    path: "/portfolio",
    label: "Mi Portfolio",
    title: "Mi Portfolio",
    subtitle: "Tus posiciones reales, su rentabilidad en euros y qué hacer con cada una.",
    blurb: "Tu cartera real en euros y, para cada posición, comprar más o mantener.",
    phase: 7,
    icon: WalletCards,
    shortcut: "2",
  },
  {
    path: "/riesgo-tecnico",
    label: "Riesgo técnico",
    title: "Riesgo técnico de largo plazo",
    subtitle: "Tendencia de fondo, caídas y volatilidad en velas mensuales y semanales.",
    blurb: "Tendencia de fondo y caídas en velas mensuales. Un semáforo por valor.",
    phase: 8,
    icon: CandlestickChart,
    shortcut: "3",
  },
  {
    path: "/estrellas",
    label: "Estrellas",
    title: "Estrellas",
    subtitle: "La mejor siguiente compra y la posición más barata hoy, con sus motivos.",
    blurb: "La mejor siguiente compra y la posición más barata hoy, con sus razones.",
    phase: 9,
    icon: Star,
    shortcut: "4",
  },
];

export const SETTINGS_SECTION = {
  path: "/ajustes",
  label: "Ajustes",
  title: "Ajustes",
  subtitle: "Claves, inteligencia artificial, datos de mercado y preferencias.",
  icon: Settings,
  shortcut: ",",
} as const;
