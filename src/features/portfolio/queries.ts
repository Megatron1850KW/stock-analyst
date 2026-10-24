import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createClaudeClient } from "@/data/claude/client";
import { tauriEuClient } from "@/data/esef/client";
import { FX_SOURCE, tauriFxClient } from "@/data/fx/frankfurter";
import { tauriSecClient } from "@/data/sec-edgar/client";
import { deleteTransaction, insertTransaction, setSecurityClassification, type TransactionInput } from "@/db/portfolio-repo";
import { getFxRates, isTracked, removeFromWatchlist, saveFxRates } from "@/db/repo";
import { FxTable, majorUnit } from "@/domain/portfolio/fx";
import { aiSpendKey, startInitialAnalysis } from "@/features/ai/queries";
import { AiAnalysisError } from "@/features/ai/equity-analysis";
import { refreshFx } from "@/features/fx/refresh";
import { startInitialPeers } from "@/features/peers/queries";
import { providersFor, refreshPrices } from "@/features/prices/refresh";
import { secUserAgent } from "@/features/settings/schema";
import type { ImportStep } from "@/features/watchlist/import-us";
import { appDb } from "@/platform/database";
import { readPdf, storeDocument } from "@/platform/documents";
import { secrets } from "@/platform/secrets";
import { loadSettings } from "@/platform/settings-store";
import { findOrImportHolding, type HoldingKind } from "./add-holding";
import { extractFundProfile, saveFundProfileEdit, type FundProfile } from "./fund-profile";
import { loadPortfolio } from "./load";

export const portfolioKey = ["portfolio"] as const;

export function usePortfolio() {
  return useQuery({ queryKey: portfolioKey, queryFn: async () => loadPortfolio(await appDb()) });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: portfolioKey });
    void qc.invalidateQueries({ queryKey: ["watchlist"] });
    void qc.invalidateQueries({ queryKey: ["comparison"] });
    void qc.invalidateQueries({ queryKey: ["stars"] });
    void qc.invalidateQueries({ queryKey: ["technical-risk"] });
    void qc.invalidateQueries({ queryKey: ["watchlist-funds"] });
  };
}

export interface NewTransaction extends Omit<TransactionInput, "securityId"> {
  /** Ticker o ISIN tal como lo escribiste. */
  input: string;
  kind: HoldingKind;
}

/**
 * Alta de una operación. Si el valor es nuevo: se buscan sus informes (acción)
 * o su bolsa (ETF/ETC), su precio y los tipos de cambio; en una acción nueva,
 * además, el análisis inicial con IA, como en la watchlist (§7).
 */
export function useAddTransaction() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const [step, setStep] = useState<ImportStep | null>(null);
  const [market, setMarket] = useState<"US" | "EU">("US");
  const mutation = useMutation({
    mutationFn: async (t: NewTransaction) => {
      const settings = await loadSettings();
      const db = await appDb();
      const ua = secUserAgent(settings);
      const holding = await findOrImportHolding(
        { db, eu: tauriEuClient(), sec: ua ? tauriSecClient(ua) : null, onStep: setStep, onMarket: setMarket },
        t.input,
        t.kind,
      );
      const { input: _input, kind: _kind, ...rest } = t;
      const id = await insertTransaction(db, { ...rest, securityId: holding.securityId });
      const notes: string[] = [];
      await refreshFx(db, tauriFxClient()).catch((e: unknown) => notes.push(`Tipos de cambio: ${e instanceof Error ? e.message : String(e)}`));
      if (!holding.existing) {
        const prices = await refreshPrices(db, providersFor(settings), holding.securityId).catch(() => null);
        for (const f of prices?.failed ?? []) notes.push(`Precio: ${f.message}`);
      }
      return { id, holding, notes };
    },
    onSettled: () => {
      setStep(null);
      invalidate();
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["security", r.holding.securityId] });
      if (r.holding.imported) startInitialAnalysis(qc, r.holding.securityId, () => startInitialPeers(qc, r.holding.securityId));
    },
  });
  return { ...mutation, step, market };
}

/** Borra una operación; si era la última de un valor que no está en la watchlist, el valor se borra también. */
export function useDeleteTransaction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, securityId }: { id: number; securityId: number }) => {
      const db = await appDb();
      await deleteTransaction(db, id);
      if (!(await isTracked(db, securityId))) await removeFromWatchlist(db, securityId);
    },
    onSuccess: invalidate,
  });
}

export function useSetClassification() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (c: { id: number; sector: string | null; country: string | null }) => setSecurityClassification(await appDb(), c.id, c),
    onSuccess: invalidate,
  });
}

/** Tipo del BCE (euros por unidad) para una divisa y fecha; lo pide si falta. */
export async function bceRate(currency: string, date: string): Promise<{ value: number; date: string } | null> {
  const db = await appDb();
  const lookup = async () => new FxTable(await getFxRates(db)).eurPer(currency, date);
  const hit = await lookup();
  if (hit) return hit;
  const from = new Date(Date.parse(date) - 7 * 86_400_000).toISOString().slice(0, 10);
  const rates = await tauriFxClient().series(from, [majorUnit(currency).currency]);
  await saveFxRates(db, rates, FX_SOURCE);
  return lookup();
}

/** Sube la ficha o KID de un ETF/ETC y la lee Haiku (una vez por archivo). */
export function useUploadFundSheet(securityId: number) {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ file, allowOverBudget }: { file: File; allowOverBudget?: boolean }) => {
      if (!/\.pdf$/i.test(file.name)) throw new AiAnalysisError("Sube la ficha o el KID en PDF.");
      if (!(await secrets.has("anthropic_api_key"))) throw new AiAnalysisError("Falta la clave de Claude. Añádela en Ajustes para leer la ficha.");
      const settings = await loadSettings();
      const stored = await storeDocument(securityId, file);
      return extractFundProfile(
        { db: await appDb(), client: createClaudeClient(), readPdf, model: settings.aiModelExtraction, budgetEur: settings.aiMonthlyBudgetEur },
        securityId,
        { path: stored.path, name: file.name, sha256: stored.sha256 },
        { allowOverBudget },
      );
    },
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: aiSpendKey });
    },
  });
}

export function useSaveFundProfile(securityId: number) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (p: FundProfile) => saveFundProfileEdit(await appDb(), securityId, p),
    onSuccess: invalidate,
  });
}
