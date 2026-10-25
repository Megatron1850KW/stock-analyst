import { AlertTriangle, Check, FileUp, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { describeError } from "@/features/watchlist/queries";
import { cn } from "@/lib/cn";
import { formatDate, formatNumber } from "@/lib/format";
import { CSV_EXAMPLE, parseTransactionsCsv } from "./import-csv";
import { useImportTransactions } from "./queries";

const TYPE_LABEL = { buy: "Compra", sell: "Venta", dividend: "Dividendo" } as const;
const qty = (n: number) => formatNumber(n, 4).replace(/,?0+$/, "");

/** Importar muchas operaciones de una vez desde un CSV, con revisión antes de guardar. */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useImportTransactions();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    run.reset();
    setText("");
    setFileName(null);
  }, [open]);

  const parsed = useMemo(() => (text.trim() ? parseTransactionsCsv(text) : null), [text]);
  const valid = parsed?.lines.filter((l) => l.tx !== null) ?? [];
  const invalid = parsed?.lines.filter((l) => l.problem !== null) ?? [];
  const outcomes = run.data?.outcomes;
  const byLine = new Map(outcomes?.map((o) => [o.line, o]));

  const count = (s: "added" | "skipped" | "failed") => outcomes?.filter((o) => o.status === s).length ?? 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Importar operaciones"
      className="w-[min(860px,calc(100vw-32px))]"
      description="Carga de una vez el histórico de tu bróker en un CSV. Revisas la lista antes de guardar; las operaciones que ya estaban no se duplican."
    >
      {!parsed && (
        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center text-[13px] hover:border-accent">
            <FileUp className="size-5 text-muted" aria-hidden />
            <span className="font-medium">Elegir el archivo CSV</span>
            <input
              type="file"
              accept=".csv,.txt,text/csv"
              aria-label="Archivo CSV"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFileName(f.name);
                setText(await f.text());
              }}
            />
          </label>
          <details className="text-[12.5px] text-muted">
            <summary className="cursor-pointer">Formato del archivo</summary>
            <p className="mt-2">
              Una línea por operación y la primera con los nombres de las columnas. Obligatorias: fecha, tipo (compra, venta o dividendo), valor (ticker o ISIN), clase (accion, etf o etc), cantidad, precio y divisa. Opcionales: comisiones, cambio_eur (euros por 1 unidad de la divisa, si quieres el de tu bróker), broker y notas.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-bg px-3 py-2 font-mono text-[11px]">{CSV_EXAMPLE}</pre>
          </details>
        </div>
      )}

      {parsed?.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-negative/10 px-3 py-2 text-[13px] text-negative-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {parsed.error}
        </p>
      )}

      {parsed && !parsed.error && (
        <>
          <p className="text-[13px]">
            {fileName && <span className="text-muted">{fileName}: </span>}
            <strong>{valid.length}</strong> operaciones listas
            {invalid.length > 0 && <>, <strong className="text-negative-text">{invalid.length}</strong> con problemas (no se importan)</>}.
          </p>
          <div className="mt-3 max-h-[46vh] overflow-auto rounded-lg border border-border">
            <table className="w-full text-[12.5px]" aria-label="Operaciones a importar">
              <thead className="sticky top-0 bg-surface text-left text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Línea</th>
                  <th className="px-2 py-1.5 font-medium">Fecha</th>
                  <th className="px-2 py-1.5 font-medium">Tipo</th>
                  <th className="px-2 py-1.5 font-medium">Valor</th>
                  <th className="px-2 py-1.5 text-right font-medium">Cantidad</th>
                  <th className="px-2 py-1.5 text-right font-medium">Precio</th>
                  <th className="px-2 py-1.5 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {parsed.lines.map((l) => {
                  const o = byLine.get(l.line);
                  const bad = l.problem ?? (o?.status === "failed" ? o.message : null);
                  return (
                    <tr key={l.line} className={cn("border-t border-border", bad && "bg-negative/5")}>
                      <td className="px-2 py-1.5 text-muted">{l.line}</td>
                      <td className="px-2 py-1.5">{l.tx ? formatDate(l.tx.date) : "—"}</td>
                      <td className="px-2 py-1.5">{l.tx ? TYPE_LABEL[l.tx.type] : "—"}</td>
                      <td className="px-2 py-1.5">{l.tx?.input ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">{l.tx ? qty(l.tx.quantity) : "—"}</td>
                      <td className="px-2 py-1.5 text-right">{l.tx ? `${formatNumber(l.tx.price, 4).replace(/(,\d\d)0+$/, "$1")} ${l.tx.currency}` : "—"}</td>
                      <td className={cn("px-2 py-1.5", bad ? "text-negative-text" : "text-muted")}>
                        {bad ?? (o?.status === "added" ? "Guardada" : o?.status === "skipped" ? o.message : "Lista")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {run.progress && (
        <p role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-[13px]">
          <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden /> Guardando {Math.min(run.progress.done + 1, run.progress.total)} de {run.progress.total}… (los valores nuevos buscan sus informes y su bolsa)
        </p>
      )}
      {run.error != null && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-negative/10 px-3 py-2 text-[13px] text-negative-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {describeError(run.error)}
        </p>
      )}
      {run.data && (
        <div role="status" className="mt-3 rounded-lg bg-positive/10 px-3 py-2 text-[13px] text-positive-text">
          <p className="flex items-center gap-2">
            <Check className="size-4" aria-hidden /> {count("added")} guardadas{count("skipped") > 0 && `, ${count("skipped")} ya estaban`}
            {count("failed") > 0 && `, ${count("failed")} sin guardar (mira la columna «Estado»)`}.
          </p>
          {run.data.notes.map((n) => <p key={n} className="mt-1 pl-6 text-muted">{n}</p>)}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        {parsed && !run.data && (
          <Button variant="ghost" onClick={() => { setText(""); setFileName(null); }} disabled={run.isPending}>Elegir otro archivo</Button>
        )}
        <Button variant="secondary" onClick={onClose}>{run.data ? "Cerrar" : "Cancelar"}</Button>
        {parsed && !parsed.error && !run.data && (
          <Button onClick={() => run.mutate(valid.map((l) => ({ line: l.line, tx: l.tx! })))} disabled={!valid.length || run.isPending}>
            {run.isPending && <Loader2 className="animate-spin" aria-hidden />} Importar {valid.length} operaciones
          </Button>
        )}
      </div>
    </Dialog>
  );
}
