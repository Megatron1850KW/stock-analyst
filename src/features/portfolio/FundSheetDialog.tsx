import { AlertTriangle, FileUp, Loader2, Sparkles } from "lucide-react";
import { ExternalLink } from "@/components/ui/external-link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { countryName } from "@/domain/portfolio/sector";
import { BudgetExceededError } from "@/features/ai/budget";
import { describeError } from "@/features/watchlist/queries";
import { formatDate, formatNumber, formatPercent, parseDecimal, SIN_DATO } from "@/lib/format";
import { REPLICATION, type FundProfile } from "./fund-profile";
import { justEtfUrl } from "@/features/watchlist/import-fund";
import type { FundProfileRow } from "./fund-profile";
import { ClaudeAiSteps } from "@/features/ai/ManualAnalysisPanel";
import { MANUAL_MODEL } from "@/features/ai/manual";
import { revealDocument } from "@/platform/documents";
import type { FundDoc } from "./fund-profile";
import { useManualFundPrompt, useSaveFundProfile, useSaveManualFund, useUploadFundSheet } from "./queries";

/** Modo manual: la ficha ya está guardada en tu Mac y se lee en claude.ai. */
function ManualFundSteps({ securityId, doc, onDone }: { securityId: number; doc: FundDoc; onDone: () => void }) {
  const prompt = useManualFundPrompt(securityId);
  const save = useSaveManualFund(securityId);
  if (prompt.error) return <p role="alert" className="text-[12.5px] text-negative-text">{describeError(prompt.error)}</p>;
  if (!prompt.data) return <div className="h-24 animate-pulse rounded-xl bg-surface" aria-busy />;
  return (
    <ClaudeAiSteps
      label={`Leer ${doc.name} con Claude.ai`}
      text={prompt.data}
      textHint="Lleva las instrucciones y el formato de la ficha."
      attach={
        <p className="mt-1 text-[12.5px]">
          Adjunta el PDF con el botón <strong>+</strong> de claude.ai o arrastrándolo.{" "}
          <button type="button" className="text-accent-text hover:underline" onClick={() => void revealDocument(doc.path)}>
            Mostrar el PDF en el Finder
          </button>
        </p>
      }
      saving={save.isPending}
      error={save.error}
      onSave={(answer) => save.mutate({ doc, answer }, { onSuccess: onDone })}
      onCancel={onDone}
    />
  );
}

const EMPTY: FundProfile = {
  ter: null, index: null, replication: null, domicile: null, aumMillions: null, aumCurrency: null, fundCurrency: null,
  distribution: null, collateral: null, holdings: [], sectors: [], countries: [], asOf: null, pages: {}, notes: [],
};

function Bars({ title, items }: { title: string; items: { key: string; weight: number }[] }) {
  if (!items.length) return null;
  const max = Math.max(...items.map((i) => i.weight));
  return (
    <div>
      <h3 className="mb-1.5 text-[12px] font-medium text-muted">{title}</h3>
      <ul className="space-y-1">
        {items.slice(0, 8).map((i) => (
          <li key={i.key} className="grid grid-cols-[minmax(0,140px)_1fr_48px] items-center gap-2 text-[12px]">
            <span className="truncate" title={i.key}>{i.key}</span>
            <span className="h-1.5 rounded-full bg-surface" aria-hidden><span className="block h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${(i.weight / max) * 100}%` }} /></span>
            <span className="text-right tabular">{formatPercent(i.weight, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lo que necesita la ficha: vale una posición de la cartera o un fondo de la watchlist. */
export interface FundSheetSubject {
  row: { id: number; ticker: string; name: string; kind: string; isin: string | null };
  fund: FundProfileRow | null;
}

/** Ficha de un ETF/ETC: la subes en PDF, Haiku la lee y puedes corregirla. */
export function FundSheetDialog({ h, onClose }: { h: FundSheetSubject | null; onClose: () => void }) {
  const id = h?.row.id ?? 0;
  const upload = useUploadFundSheet(id);
  const save = useSaveFundProfile(id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ter: "", index: "", replication: "", domicile: "" });
  const profile = h?.fund?.profile ?? null;

  useEffect(() => {
    upload.reset();
    setEditing(false);
    setPending(null);
    setDraft({
      ter: profile?.ter != null ? formatNumber(profile.ter * 100, 2) : "",
      index: profile?.index ?? "",
      replication: profile?.replication ?? "",
      domicile: profile?.domicile ?? "",
    });
  }, [h?.row.id, profile]); // reinicia al abrir otra ficha

  function send(file: File, allowOverBudget = false) {
    setPending(file);
    upload.mutate({ file, allowOverBudget });
  }

  function saveEdit() {
    const ter = draft.ter.trim() ? parseDecimal(draft.ter) : null;
    save.mutate(
      {
        ...(profile ?? EMPTY),
        ter: ter === null ? null : ter / 100,
        index: draft.index.trim() || null,
        replication: (draft.replication || null) as FundProfile["replication"],
        domicile: /^[A-Z]{2}$/.test(draft.domicile.trim().toUpperCase()) ? draft.domicile.trim().toUpperCase() : null,
      },
      { onSuccess: () => setEditing(false) },
    );
  }

  const over = upload.error instanceof BudgetExceededError ? upload.error : null;
  const manualDoc = upload.data?.status === "manual" ? upload.data.doc : null;
  const meta = h?.fund;

  return (
    <Dialog
      open={!!h}
      onClose={onClose}
      className="w-[min(640px,calc(100vw-32px))]"
      title={h ? `Ficha de ${h.row.ticker}` : ""}
      description={
        <>
          {h?.row.name}. Los {h?.row.kind === "etc" ? "ETC" : "ETF"} no tienen informes de empresa: sus datos salen de su ficha mensual o de su KID (documento de datos fundamentales), que encontrarás en{" "}
          {h?.row.isin ? <ExternalLink href={justEtfUrl(h.row.isin)} className="underline underline-offset-2">su página de justETF</ExternalLink> : "justETF"} o en la web de la gestora.
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) send(f);
          e.target.value = "";
        }}
      />
      {manualDoc && <ManualFundSteps securityId={id} doc={manualDoc} onDone={() => upload.reset()} />}
      {profile && !editing && !manualDoc && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            {meta?.origin === "pdf-extraction" && <Badge tone="accent"><Sparkles aria-hidden /> Leída {meta.model === MANUAL_MODEL ? "en claude.ai" : "por IA"} de {meta.doc_name}</Badge>}
            {meta?.edited_at && <Badge>Corregida por ti</Badge>}
            {profile.asOf && <span>Datos a {formatDate(profile.asOf)}</span>}
            {meta?.cost_eur != null && <span>· coste {meta.cost_eur < 0.01 ? "menos de 1 céntimo" : `${formatNumber(meta.cost_eur, 2)} €`}</span>}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            {[
              ["Coste anual (TER)", profile.ter != null ? formatPercent(profile.ter, 2) : null, "ter"],
              [h?.row.kind === "etc" ? "Materia prima" : "Índice", profile.index, "index"],
              ["Réplica", profile.replication, "replication"],
              ["Domicilio", profile.domicile ? countryName(profile.domicile) : null, "domicile"],
              ["Tamaño", profile.aumMillions != null ? `${formatNumber(profile.aumMillions, 0)} M ${profile.aumCurrency ?? ""}` : null, "aumMillions"],
              ["Dividendos", profile.distribution, "distribution"],
              ...(h?.row.kind === "etc" ? [["Respaldo", profile.collateral, "collateral"] as const] : []),
            ].map(([label, value, field]) => (
              <div key={label as string}>
                <dt className="text-[12px] text-muted">{label}</dt>
                <dd>
                  {value ?? <span className="text-muted">{SIN_DATO}</span>}
                  {value && profile.pages[field as string] && <span className="ml-1 text-[11px] text-muted">(pág. {profile.pages[field as string]})</span>}
                </dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-4 sm:grid-cols-2">
            <Bars title="Sectores" items={profile.sectors} />
            <Bars title="Países" items={profile.countries.map((c) => ({ ...c, key: countryName(c.key) }))} />
          </div>
          <Bars title="Principales posiciones" items={profile.holdings.map((x) => ({ key: x.name, weight: x.weight }))} />
          {profile.notes.map((n) => <p key={n} className="text-[12px] text-muted">{n}</p>)}
        </div>
      )}
      {editing && (
        <div className="grid gap-3 text-[13px]">
          <label className="grid gap-1"><span className="font-medium">Coste anual (TER, %)</span><Input inputMode="decimal" value={draft.ter} onChange={(e) => setDraft({ ...draft, ter: e.target.value })} placeholder="0,20" /></label>
          <label className="grid gap-1"><span className="font-medium">{h?.row.kind === "etc" ? "Materia prima" : "Índice"}</span><Input value={draft.index} onChange={(e) => setDraft({ ...draft, index: e.target.value })} /></label>
          <label className="grid gap-1">
            <span className="font-medium">Réplica</span>
            <Select value={draft.replication} onChange={(e) => setDraft({ ...draft, replication: e.target.value })}>
              <option value="">Sin dato</option>
              {REPLICATION.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </label>
          <label className="grid gap-1"><span className="font-medium">Domicilio (código de país)</span><Input value={draft.domicile} onChange={(e) => setDraft({ ...draft, domicile: e.target.value })} placeholder="IE" className="uppercase" /></label>
        </div>
      )}
      {!profile && !editing && !upload.isPending && !manualDoc && (
        <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-[13px] text-muted">
          Sin ficha todavía. Sube el PDF y Claude copiará su coste, índice, réplica, tamaño y reparto por sectores y países, con la página de cada dato. Se hace una sola vez.
        </div>
      )}
      {upload.isPending && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-[13px]">
          <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden /> Leyendo {pending?.name}…
        </p>
      )}
      {upload.error && !over && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-negative/10 px-3 py-2 text-[13px] text-negative-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {describeError(upload.error)}
        </p>
      )}
      {over && pending && (
        <div role="alert" className="mt-3 rounded-lg bg-warning/12 px-3 py-2 text-[13px] text-warning-text">
          Leer esta ficha (~{formatNumber(over.estimateEur, 2)} €) superaría tu presupuesto mensual de IA ({formatNumber(over.spentEur, 2)} de {formatNumber(over.budgetEur, 2)} €).
          <Button size="sm" variant="secondary" className="ml-2" onClick={() => send(pending, true)}>Leer igualmente</Button>
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {editing ? (
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={save.isPending}>Guardar</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setEditing(true)}>Corregir a mano</Button>
            <Button variant={profile ? "secondary" : "primary"} onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              <FileUp aria-hidden /> {profile ? "Subir otra ficha" : "Subir ficha o KID (PDF)"}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
