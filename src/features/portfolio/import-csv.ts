import { looksLikeIsin } from "@/features/watchlist/import-us";
import { parseDecimal } from "@/lib/format";
import type { HoldingKind } from "./add-holding";
import type { NewTransaction } from "./queries";

/**
 * Operaciones en bloque desde un CSV (p. ej. el histórico de tu bróker pasado
 * a tabla). Mismas reglas que «Nueva operación»; cada línea con problemas se
 * explica en llano y no se importa. Puro y sin red: el alta va en import-transactions.ts.
 *
 * Columnas (cabecera obligatoria, en cualquier orden, separadas por «;», «,» o tabulador):
 *   fecha, tipo, valor, clase, cantidad, precio, divisa  — obligatorias
 *   comisiones, cambio_eur, broker, notas               — opcionales
 */

export const CSV_COLUMNS = ["fecha", "tipo", "valor", "clase", "cantidad", "precio", "divisa", "comisiones", "cambio_eur", "broker", "notas"] as const;
const REQUIRED = ["fecha", "tipo", "valor", "clase", "cantidad", "precio", "divisa"] as const;
export const CSV_CURRENCIES = ["EUR", "USD", "GBP", "GBp", "CHF", "SEK", "DKK", "NOK"];

export const CSV_EXAMPLE = [
  "fecha;tipo;valor;clase;cantidad;precio;divisa;comisiones;cambio_eur;broker;notas",
  "2024-03-15;compra;ES0148396007;accion;20;45,10;EUR;8;;ING;",
  "2024-06-02;compra;IE00BDFL4P12;etf;35;5,62;EUR;0;;ING;",
  "2025-01-10;compra;MSFT;accion;3;420,50;USD;12;0,9180;ING;",
].join("\n");

export interface CsvLine {
  /** Nº de línea en el archivo (la cabecera es la 1). */
  line: number;
  tx: NewTransaction | null;
  problem: string | null;
}

const TYPE_WORDS: Record<string, NewTransaction["type"]> = { compra: "buy", buy: "buy", venta: "sell", sell: "sell", dividendo: "dividend", dividend: "dividend" };
const KIND_WORDS: Record<string, HoldingKind> = { accion: "stock", acción: "stock", acciones: "stock", stock: "stock", etf: "etf", etc: "etc" };

const strip = (s: string) => s.trim().replace(/^"(.*)"$/s, "$1").trim();
const key = (s: string) => strip(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s-]+/g, "_");

/** AAAA-MM-DD o DD/MM/AAAA (también con guiones o puntos). */
export function parseCsvDate(raw: string): string | null {
  const s = strip(raw);
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const es = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (es) [d, m, y] = [Number(es[1]), Number(es[2]), Number(es[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Separa una línea respetando las comillas (un «;» o «,» dentro de "…" no corta). */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    if (ch === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseTransactionsCsv(text: string, today = new Date().toISOString().slice(0, 10)): { lines: CsvLine[]; error: string | null } {
  const raw = text.replace(/^﻿/, "").split(/\r?\n/);
  const header = raw[0] ?? "";
  const sep = header.includes("\t") ? "\t" : header.includes(";") ? ";" : ",";
  const cols = splitLine(header, sep).map(key);
  const missing = REQUIRED.filter((c) => !cols.includes(c));
  if (!header.trim() || missing.length) {
    return { lines: [], error: `La primera línea debe tener los nombres de las columnas. Faltan: ${missing.join(", ")}.` };
  }
  const at = (cells: string[], c: (typeof CSV_COLUMNS)[number]) => {
    const i = cols.indexOf(c);
    return i < 0 ? "" : strip(cells[i] ?? "");
  };

  const lines: CsvLine[] = [];
  raw.slice(1).forEach((text, i) => {
    if (!text.trim() || /^[;,\t\s]*$/.test(text)) return;
    const line = i + 2;
    const cells = splitLine(text, sep);
    const fail = (problem: string) => lines.push({ line, tx: null, problem });

    const date = parseCsvDate(at(cells, "fecha"));
    const type = TYPE_WORDS[key(at(cells, "tipo"))];
    const input = at(cells, "valor").toUpperCase();
    const kind = KIND_WORDS[key(at(cells, "clase"))];
    const quantity = parseDecimal(at(cells, "cantidad"));
    const price = parseDecimal(at(cells, "precio"));
    const curRaw = at(cells, "divisa");
    const currency = CSV_CURRENCIES.find((c) => c === curRaw) ?? CSV_CURRENCIES.find((c) => c === curRaw.toUpperCase());
    const feesRaw = at(cells, "comisiones");
    const fees = feesRaw ? parseDecimal(feesRaw) : 0;
    const fxRaw = at(cells, "cambio_eur");
    const fx = fxRaw ? parseDecimal(fxRaw) : null;

    if (!date) return fail("La fecha no es válida (usa AAAA-MM-DD o DD/MM/AAAA).");
    if (date > today) return fail("La fecha es futura.");
    if (!type) return fail("El tipo debe ser compra, venta o dividendo.");
    if (!input) return fail("Falta el valor (ticker o ISIN).");
    if (!kind) return fail("La clase debe ser accion, etf o etc.");
    if (kind !== "stock" && !looksLikeIsin(input)) return fail(`Para un ${kind.toUpperCase()} hace falta su ISIN.`);
    if (quantity === null || quantity <= 0) return fail("La cantidad tiene que ser mayor que cero.");
    if (price === null || price <= 0) return fail(type === "dividend" ? "Falta el dividendo bruto por acción." : "Falta el precio por acción.");
    if (!currency) return fail(`Divisa no reconocida («${curRaw}»). Usa ${CSV_CURRENCIES.join(", ")}.`);
    if (fees === null || fees < 0) return fail("Las comisiones no son un número válido.");
    if (fxRaw && (fx === null || fx <= 0)) return fail("El cambio a euros no es válido.");

    lines.push({
      line,
      problem: null,
      tx: {
        input,
        kind,
        type,
        date,
        quantity,
        price,
        currency,
        fees,
        fxRateToBase: currency === "EUR" ? null : fx,
        broker: at(cells, "broker") || null,
        notes: at(cells, "notas") || null,
      },
    });
  });
  if (!lines.length) return { lines, error: "El archivo no tiene operaciones debajo de la cabecera." };
  return { lines, error: null };
}
