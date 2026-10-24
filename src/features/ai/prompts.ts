import equityAnalysisRaw from "../../../prompts/equity-analysis.md?raw";
import pdfExtractionRaw from "../../../prompts/pdf-extraction.md?raw";
import peersRaw from "../../../prompts/peers.md?raw";
import etfExtractionRaw from "../../../prompts/etf-extraction.md?raw";

/** Prompt versionado (CLAUDE.md §7): cabecera con id y versión + texto. */
export interface Prompt {
  id: string;
  version: string;
  /** "equity-analysis@1": entra en la clave de caché. */
  key: string;
  text: string;
}

export function parsePrompt(raw: string): Prompt {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw.replace(/\r\n/g, "\n"));
  if (!m) throw new Error("Prompt sin cabecera");
  const meta = Object.fromEntries(
    m[1]!.split("\n").map((l) => {
      const i = l.indexOf(":");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
  if (!meta.id || !meta.version) throw new Error("La cabecera del prompt necesita id y version");
  return { id: meta.id, version: meta.version, key: `${meta.id}@${meta.version}`, text: m[2]!.trim() };
}

export const EQUITY_ANALYSIS_PROMPT = parsePrompt(equityAnalysisRaw);
export const PEERS_PROMPT = parsePrompt(peersRaw);
export const PDF_EXTRACTION_PROMPT = parsePrompt(pdfExtractionRaw);
export const ETF_EXTRACTION_PROMPT = parsePrompt(etfExtractionRaw);
