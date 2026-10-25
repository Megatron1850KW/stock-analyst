import { listen } from "@tauri-apps/api/event";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { tauriEuClient } from "@/data/esef/client";
import { tauriSecClient } from "@/data/sec-edgar/client";
import { getAppState, listCalendar, listNewReports, setNewReportStatus } from "@/db/calendar-repo";
import { analyzeSecurity } from "@/features/ai/queries";
import { secUserAgent } from "@/features/settings/schema";
import { appDb } from "@/platform/database";
import { notify } from "@/platform/notify";
import { inDesktopApp } from "@/platform/runtime";
import { loadSettings } from "@/platform/settings-store";
import { checkIsDue, checkNewReports, LAST_CHECK_KEY, processNewReport, refreshCalendar, type CheckResult } from "./check";

export const calendarKey = ["calendar"] as const;
const APP = "Stock Analisis";

export function useCalendar() {
  return useQuery({
    queryKey: calendarKey,
    queryFn: async () => {
      const db = await appDb();
      await refreshCalendar(db);
      const [rows, reports, lastCheck] = await Promise.all([listCalendar(db), listNewReports(db), getAppState(db, LAST_CHECK_KEY)]);
      return { rows, reports, lastCheck };
    },
  });
}

async function deps() {
  const settings = await loadSettings();
  const ua = secUserAgent(settings);
  return { settings, db: await appDb(), sec: ua ? tauriSecClient(ua) : null, eu: tauriEuClient() };
}

function invalidateAll(qc: QueryClient) {
  for (const key of ["calendar", "watchlist", "comparison", "stars", "portfolio", "security", "document-requests"]) void qc.invalidateQueries({ queryKey: [key] });
}

/** Analiza un informe nuevo: datos (determinista) y, después, la IA. */
async function process(qc: QueryClient, reportId: number) {
  const d = await deps();
  const out = await processNewReport({ ...d, analyze: (id) => analyzeSecurity(id) }, reportId);
  invalidateAll(qc);
  void qc.invalidateQueries({ queryKey: ["ai-analysis"] });
  void qc.invalidateQueries({ queryKey: ["ai-spend"] });
  return out;
}

let running: Promise<CheckResult> | null = null;

/**
 * Comprobación de informes nuevos (sin IA). Avisa con una notificación de
 * macOS por cada uno; en modo automático, además, lo analiza.
 */
export async function runCheck(qc: QueryClient, force: boolean): Promise<CheckResult> {
  if (running) return running;
  running = (async () => {
    const d = await deps();
    const result = await checkNewReports(d, { force });
    for (const r of result.found) {
      const auto = d.settings.newReportAction === "auto";
      await notify(APP, `Ha salido el ${r.label} de ${r.ticker}. ${auto ? "Lo estoy analizando." : "¿Analizar ahora? Ábrelo en el Calendario."}`).catch(() => false);
      if (auto) {
        const [row] = (await listNewReports(d.db, true)).filter((x) => x.security_id === r.securityId && x.label === r.label);
        if (row) {
          const out = await process(qc, row.id).catch((e: unknown) => ({ aiError: e instanceof Error ? e.message : String(e) }));
          await notify(APP, out.aiError ? `${r.ticker}: datos actualizados, pero el análisis con IA no se hizo (${out.aiError})` : `${r.ticker}: análisis del ${r.label} listo.`).catch(() => false);
        }
      }
    }
    invalidateAll(qc);
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function useCheckNow() {
  const qc = useQueryClient();
  return useMutation({ mutationKey: ["check-reports"], mutationFn: () => runCheck(qc, true) });
}

export function useProcessReport() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (reportId: number) => process(qc, reportId) });
}

export function useDismissReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: number) => setNewReportStatus(await appDb(), reportId, "dismissed"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: calendarKey }),
  });
}

/** Cada cuánto se mira si toca la comprobación (la app puede estar días en la barra de menús). */
const TICK_MS = 60 * 60 * 1000;

/**
 * Tarea de fondo (CLAUDE.md §7): al abrir y cada hora mira si toca la
 * comprobación según Ajustes (por defecto, una vez al día). Nunca llama a la
 * IA salvo en modo automático y con un informe nuevo. El menú de la barra
 * de menús puede pedirla en cualquier momento.
 */
export function useBackgroundChecks() {
  const qc = useQueryClient();
  useEffect(() => {
    if (!inDesktopApp) return;
    let stop = false;
    const tick = async () => {
      try {
        const settings = await loadSettings();
        if (!stop && (await checkIsDue(await appDb(), settings.reportCheckFrequency))) await runCheck(qc, false);
      } catch (e) {
        console.warn("[calendario] comprobación no realizada:", e instanceof Error ? e.message : e);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), TICK_MS);
    const unlisten = listen("check-reports", () => void runCheck(qc, true).catch(() => undefined));
    return () => {
      stop = true;
      clearInterval(timer);
      void unlisten.then((f) => f());
    };
  }, [qc]);
}
