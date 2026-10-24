import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Holding } from "./load";
import { EU_STEP_LABELS } from "@/features/watchlist/import-eu";
import { IMPORT_STEP_LABELS, looksLikeIsin } from "@/features/watchlist/import-us";
import { describeError } from "@/features/watchlist/queries";
import { formatDate, formatNumber, parseDecimal } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { HoldingKind } from "./add-holding";
import { bceRate, useAddTransaction } from "./queries";

const CURRENCIES = ["EUR", "USD", "GBP", "GBp", "CHF", "SEK", "DKK", "NOK"] as const;
const CURRENCY_LABEL: Record<string, string> = { GBp: "GBp (peniques)" };
const TYPES = [
  { id: "buy", label: "Compra" },
  { id: "sell", label: "Venta" },
  { id: "dividend", label: "Dividendo" },
] as const;
const KINDS: { id: HoldingKind; label: string }[] = [
  { id: "stock", label: "Acción" },
  { id: "etf", label: "ETF" },
  { id: "etc", label: "ETC" },
];

type TxType = (typeof TYPES)[number]["id"];

function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: readonly { id: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-surface p-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn("h-7 rounded-md px-3 text-[13px] transition-colors duration-150", value === it.id ? "bg-surface-raised font-medium shadow-card" : "text-muted hover:text-text")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] items-start gap-4 py-2">
      <label htmlFor={htmlFor} className="pt-1.5 text-[13px] font-medium">{label}</label>
      <div>
        {children}
        {hint && <p className="mt-1 text-[12px] leading-relaxed text-muted">{hint}</p>}
      </div>
    </div>
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function TransactionDialog({ open, onClose, holdings, preset }: { open: boolean; onClose: () => void; holdings: Holding[]; preset?: { input: string; type?: TxType } }) {
  const add = useAddTransaction();
  const [type, setType] = useState<TxType>("buy");
  const [input, setInput] = useState("");
  const [kind, setKind] = useState<HoldingKind>("stock");
  const [date, setDate] = useState(todayIso());
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<string>("EUR");
  const [fees, setFees] = useState("");
  const [ownFx, setOwnFx] = useState(false);
  const [fx, setFx] = useState("");
  const [broker, setBroker] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [bce, setBce] = useState<{ value: number; date: string } | null | "loading" | "error">(null);

  const known = holdings.find((h) => h.row.ticker.toUpperCase() === input.trim().toUpperCase() || h.row.isin === input.trim().toUpperCase());

  useEffect(() => {
    if (!open) return;
    add.reset();
    setError(undefined);
    setInput(preset?.input ?? "");
    setType(preset?.type ?? "buy");
    setKind("stock");
    setDate(todayIso());
    setQuantity("");
    setPrice("");
    setFees("");
    setOwnFx(false);
    setFx("");
    setBroker("");
    setNotes("");
  }, [open]);

  // Un valor que ya tienes fija su tipo y su divisa
  useEffect(() => {
    if (known) {
      setKind(known.row.kind);
      setCurrency(known.row.currency);
    } else if (input.trim().length >= 2) {
      const v = input.trim().toUpperCase();
      setCurrency(looksLikeIsin(v) && !v.startsWith("US") ? "EUR" : "USD");
    }
  }, [known?.row.id, input]);

  // Tipo del BCE para esa fecha (si no es en euros)
  useEffect(() => {
    if (!open || currency === "EUR" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setBce(null);
      return;
    }
    let alive = true;
    setBce("loading");
    bceRate(currency, date).then(
      (r) => alive && setBce(r),
      () => alive && setBce("error"),
    );
    return () => {
      alive = false;
    };
  }, [open, currency, date]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = parseDecimal(quantity);
    const p = parseDecimal(price);
    const f = fees.trim() ? parseDecimal(fees) : 0;
    const r = ownFx ? parseDecimal(fx) : null;
    const problem =
      !input.trim() ? "Escribe el ticker o el ISIN."
      : (type !== "buy" && !known) ? `No tienes operaciones de ${input.trim().toUpperCase()}: registra antes la compra.`
      : !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIso() ? "La fecha no es válida (no puede ser futura)."
      : q === null || q <= 0 ? "La cantidad tiene que ser mayor que cero."
      : p === null || p <= 0 ? (type === "dividend" ? "Indica el dividendo bruto por acción." : "Indica el precio por acción.")
      : f === null || f < 0 ? "Las comisiones no son un número válido."
      : ownFx && (r === null || r <= 0) ? "El tipo de cambio de tu bróker no es válido."
      : type === "sell" && known && q > known.position.shares + 1e-9 ? `Solo tienes ${formatNumber(known.position.shares, 4).replace(/,?0+$/, "")} acciones.`
      : null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(undefined);
    add.mutate(
      {
        input: known ? (known.row.isin ?? known.row.ticker) : input.trim(),
        kind,
        type,
        date,
        quantity: q!,
        price: p!,
        currency,
        fees: f!,
        fxRateToBase: currency === "EUR" ? null : r,
        broker: broker.trim() || null,
        notes: notes.trim() || null,
      },
      { onSuccess: (res) => res.notes.length === 0 && onClose() },
    );
  }

  const labels = add.market === "EU" ? EU_STEP_LABELS : IMPORT_STEP_LABELS;
  const cur = currency === "GBp" ? "GBP" : currency;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nueva operación"
      description="Apunta una compra, una venta o un dividendo. Si el valor es nuevo, la app busca sus informes oficiales (acciones) o su cotización (ETFs y ETCs)."
    >
      <form onSubmit={onSubmit} noValidate>
        <div className="mb-2">
          <Segmented label="Tipo de operación" value={type} onChange={setType} items={TYPES} />
        </div>
        <Row label="Valor" htmlFor="tx-input" hint={known ? <>Ya lo tienes: <b>{known.row.name}</b></> : "Ticker de EE. UU. (AAPL) o ISIN (ES0148396007, IE00B4L5Y983…)."}>
          <Input id="tx-input" list="tx-holdings" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ticker o ISIN" className="uppercase placeholder:normal-case" autoFocus />
          <datalist id="tx-holdings">
            {holdings.map((h) => <option key={h.row.id} value={h.row.ticker}>{h.row.name}</option>)}
          </datalist>
        </Row>
        {!known && (
          <Row label="Tipo de valor">
            <Segmented label="Tipo de valor" value={kind} onChange={setKind} items={KINDS} />
          </Row>
        )}
        <Row label="Fecha" htmlFor="tx-date">
          <Input id="tx-date" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </Row>
        <Row label={type === "dividend" ? "Acciones con derecho" : "Cantidad"} htmlFor="tx-q">
          <Input id="tx-q" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="10" className="tabular" />
        </Row>
        <Row label={type === "dividend" ? "Dividendo bruto por acción" : "Precio por acción"} htmlFor="tx-p">
          <div className="flex gap-2">
            <Input id="tx-p" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="123,45" className="tabular" />
            <Select aria-label="Divisa" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-[150px]">
              {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c] ?? c}</option>)}
            </Select>
          </div>
        </Row>
        <Row label={type === "dividend" ? "Retención" : "Comisiones"} htmlFor="tx-f" hint={type === "dividend" ? "Lo que te retuvieron, en la misma divisa." : "Todas las del bróker, en la misma divisa."}>
          <Input id="tx-f" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" className="tabular" />
        </Row>
        {currency !== "EUR" && (
          <Row
            label="Tipo de cambio"
            hint={
              bce === "loading" ? "Buscando el tipo del BCE…"
              : bce === "error" ? "No he podido traer el tipo del BCE; se intentará de nuevo al actualizar precios."
              : bce ? <>BCE: 1 {cur} = {formatNumber(bce.value * (currency === "GBp" ? 100 : 1), 4)} € ({formatDate(bce.date)}). Se usa salvo que indiques el de tu bróker.</>
              : "Sin tipo del BCE para esa fecha."
            }
          >
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={ownFx} onChange={(e) => setOwnFx(e.target.checked)} className="accent-[var(--accent)]" />
              Usar el de mi bróker
            </label>
            {ownFx && (
              <div className="mt-2 flex items-center gap-2 text-[13px]">
                <Input aria-label={`Euros por 1 ${currency}`} inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} placeholder="0,9234" className="w-[120px] tabular" />
                <span className="text-muted">€ por 1 {currency}</span>
              </div>
            )}
          </Row>
        )}
        <Row label="Bróker" htmlFor="tx-b">
          <Input id="tx-b" value={broker} onChange={(e) => setBroker(e.target.value)} placeholder="Opcional" />
        </Row>
        <Row label="Notas" htmlFor="tx-n">
          <Input id="tx-n" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </Row>

        {add.step && (
          <p role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-[13px]">
            <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden /> {labels[add.step]}…
          </p>
        )}
        {(error || add.error) && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-negative/10 px-3 py-2 text-[13px] text-negative-text">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error ?? describeError(add.error)}
          </p>
        )}
        {add.data && add.data.notes.length > 0 && (
          <div role="status" className="mt-3 rounded-lg bg-positive/10 px-3 py-2 text-[13px] text-positive-text">
            <p className="flex items-center gap-2"><Check className="size-4" aria-hidden /> Operación guardada.</p>
            {add.data.notes.map((n) => <p key={n} className="mt-1 pl-6 text-muted">{n}</p>)}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{add.data ? "Cerrar" : "Cancelar"}</Button>
          {!add.data && (
            <Button type="submit" disabled={add.isPending}>
              {add.isPending && <Loader2 className="animate-spin" aria-hidden />} Guardar operación
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
