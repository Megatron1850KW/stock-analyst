import type { EquityAnalysis } from "@/features/ai/schema";

/**
 * Respuestas FICTICIAS de la API de Claude para los tests (sin red ni clave).
 * Se sustituye el `fetch` del SDK oficial: así se prueba también la petición real que construye.
 */

export const FAKE_ANALYSIS: EquityAnalysis = {
  modelo_negocio:
    "FICTICIA CORP (empresa inventada para pruebas) vende piezas industriales a fabricantes de maquinaria. Gana dinero con la venta de piezas y con contratos de mantenimiento. Tiene dos segmentos: piezas y servicios.",
  outlook: {
    resumen: "La dirección espera seguir creciendo gracias a los contratos de servicios (dato ficticio).",
    guidance: [{ texto: "Espera ampliar la planta en 2027.", cita: { documento: "0009999999-26-000020", seccion: "Comentario de la dirección (MD&A)", texto: "We expect to expand our plant in 2027." } }],
  },
  catalizadores: [
    { titulo: "Nuevos contratos de servicio", detalle: "Más ingresos recurrentes.", cita: { documento: "0009999999-26-000020", seccion: "Negocio", texto: "Service contracts grew." } },
  ],
  riesgos: [
    { titulo: "Dependencia de un cliente", detalle: "Un cliente supone gran parte de las ventas.", gravedad: "alta", cita: { documento: "0009999999-26-000020", seccion: "Factores de riesgo", texto: "One customer accounts for a large share of revenue." } },
    { titulo: "Cita inventada", detalle: "Prueba de cita a un documento que no existe.", gravedad: "baja", cita: { documento: "0000000000-00-000000", seccion: "?", texto: "" } },
  ],
  veredicto: {
    postura: "Neutral",
    resumen: "Negocio estable con caja positiva; la valoración frente a su historia no da un margen claro. Datos ficticios de prueba.",
  },
  puntos_clave: ["Genera caja", "Deuda baja", "Precio en su media"],
  datos_no_encontrados: [],
};

export interface FakeClaudeOptions {
  analysis?: unknown;
  stopReason?: string;
  status?: number;
  model?: string;
  usage?: Partial<Record<"input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens", number>>;
}

export function fakeClaudeFetch(opts: FakeClaudeOptions = {}) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    requests.push({ url: String(input), headers, body: JSON.parse(String(init?.body)) });
    if (opts.status && opts.status !== 200) {
      return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "simulado" } }), {
        status: opts.status,
        headers: { "content-type": "application/json", "x-should-retry": "false" },
      });
    }
    const message = {
      id: "msg_ficticio",
      type: "message",
      role: "assistant",
      model: opts.model ?? "claude-sonnet-5-5",
      content: [{ type: "text", text: JSON.stringify(opts.analysis ?? FAKE_ANALYSIS) }],
      stop_reason: opts.stopReason ?? "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 30_000, output_tokens: 4_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...opts.usage },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchImpl, requests };
}

/** Informe FICTICIO en HTML con índice y secciones, como los 10-K/10-Q reales. */
export function fakeReportHtml(form: "10-K" | "10-Q"): string {
  const para = (t: string) => `<p>${t}</p>`.repeat(12);
  if (form === "10-Q") {
    return `<html><body><ix:header><ix:hidden>dei:Ficticio</ix:hidden></ix:header>
      <table><tr><td>Item 2.</td><td>Management&#8217;s Discussion and Analysis</td></tr><tr><td>Item 3.</td><td>Quantitative</td></tr></table>
      <div><span>Item 2.</span> <span>Management's Discussion and Analysis of Financial Condition</span></div>
      ${para("Revenue grew in the quarter thanks to service contracts. We expect to expand our plant in 2027.")}
      <div>Item 3. Quantitative and Qualitative Disclosures About Market Risk</div><p>None.</p>
      <div>Item 4. Controls and Procedures</div></body></html>`;
  }
  return `<html><head><style>p{}</style></head><body>
    <div>Item 1. Business</div><div>Item 1A. Risk Factors</div><div>Item 7. Management&#8217;s Discussion</div><div>Item 8. Financial Statements</div>
    <div>ITEM 1. BUSINESS</div>${para("FICTICIA CORP sells industrial parts. Service contracts grew.")}
    <div>ITEM 1A. RISK FACTORS</div>${para("One customer accounts for a large share of revenue.")}
    <div>ITEM 1B. UNRESOLVED STAFF COMMENTS</div><p>None.</p>
    <div>ITEM 7. MANAGEMENT&#8217;S DISCUSSION AND ANALYSIS</div>${para("Margins improved &amp; cash flow was strong.")}
    <div>ITEM 7A. QUANTITATIVE AND QUALITATIVE DISCLOSURES</div><p>Interest rate risk.</p>
    <div>ITEM 8. FINANCIAL STATEMENTS</div></body></html>`;
}
