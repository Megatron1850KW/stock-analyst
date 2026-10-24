import { createHashRouter, Navigate, type RouteObject } from "react-router";
import { ComparisonPage } from "@/features/comparison/ComparisonPage";
import { PortfolioPage } from "@/features/portfolio/PortfolioPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { StarsPage } from "@/features/stars/StarsPage";
import { TechnicalRiskPage } from "@/features/technical-risk/TechnicalRiskPage";
import { SecurityDetailPage } from "@/features/watchlist/SecurityDetailPage";
import { WatchlistPage } from "@/features/watchlist/WatchlistPage";
import { AppLayout } from "./AppLayout";
import { SectionColumns } from "./SectionColumns";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <ComparisonPage /> },
      {
        element: <SectionColumns />,
        children: [
          { path: "watchlist", element: <WatchlistPage /> },
          { path: "watchlist/:id", element: <SecurityDetailPage /> },
          { path: "portfolio", element: <PortfolioPage /> },
          { path: "riesgo-tecnico", element: <TechnicalRiskPage /> },
          { path: "estrellas", element: <StarsPage /> },
        ],
      },
      { path: "ajustes", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

// Hash router: la app se sirve desde ficheros locales dentro del .app
export const router = createHashRouter(routes);
