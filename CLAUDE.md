# CLAUDE.md — Agente Financiero (App de Mac)

> Documento de contexto para Claude Code. Léelo entero antes de escribir código.
> Si algo de este archivo choca con una petición puntual del usuario, pregunta antes de actuar.

---

## 1. Qué estamos construyendo

Una **aplicación de escritorio para macOS** que actúa como **analista financiero personal (Equity Analyst)** del usuario (Pablo, inversor particular en Valencia, España, divisa base **EUR**).

La app:

1. Analiza **acciones europeas y estadounidenses** (por **Ticker o ISIN**) con un *deep dive* fundamental resumido.
2. Basa el análisis en **datos fundamentales oficiales**: los **3 últimos 10-K y 3 últimos 10-Q** (EE. UU.) o sus **equivalentes europeos** (informes anuales y semestrales/trimestrales).
3. Gestiona el **portfolio real** del usuario (acciones, ETFs y ETCs) y recomienda **Comprar más / Mantener** posición a posición.
4. Hace un **análisis de riesgo técnico de largo plazo** (velas mensuales/semanales sobre varios años, nunca intradía ni horizonte semanal).
5. Marca con **⭐ estrella**: la mejor siguiente compra de la watchlist y la posición de cartera más barata hoy.
6. Funciona de forma **autónoma**: calendario interno de resultados, detección de nuevos informes y notificaciones de macOS, **sin llamar a la IA continuamente**.

Entorno del usuario: **Mac con Apple Silicon (M5), macOS 27**. Idioma de la interfaz: **español**. Números en formato español (1.234,56 €).

---

## 2. Principios no negociables

1. **No inventar datos.** Si una cifra no está en una fuente, se muestra "Sin dato" y se pide al usuario. Nunca rellenar con estimaciones silenciosas.
2. **Trazabilidad de cada cifra.** Todo dato guarda: fuente, documento (p. ej. nº de accession de la SEC), periodo, fecha de obtención. La UI debe permitir ver el origen con un clic/hover.
3. **Separar hechos de inferencias.** Las cifras calculadas de forma determinista se muestran como hechos; las conclusiones generadas por la IA se etiquetan visualmente como "Análisis IA".
4. **Cálculo determinista primero, IA después.** Ratios, crecimientos, márgenes, valoraciones y puntuaciones se calculan en código. La IA solo redacta narrativa (modelo de negocio, outlook, catalizadores, riesgos, veredicto) y extrae datos de PDFs cuando no hay XBRL.
5. **Gasto mínimo en IA.** Ver §7. Nada de llamadas en bucle ni al abrir la app.
6. **Lenguaje para no expertos.** Ver §6. Ningún ratio técnico en la UI principal sin traducción a lenguaje llano.
7. **Sin secretos en el repo.** API keys en el **Llavero de macOS (Keychain)**, nunca en código, `.env` versionado ni logs.
8. **Validar salidas con esquemas.** Toda respuesta de la IA y de APIs externas se valida (Zod en TS / serde en Rust). Si no valida, se descarta y se registra el error.
9. **Datos ficticios solo en tests**, siempre etiquetados como tales, nunca en la base de datos real.
10. **Aviso legal visible**: "Herramienta informativa, no constituye asesoramiento financiero." en pie de página y en cada recomendación.

---

## 3. Stack técnico

| Capa | Elección | Motivo |
|---|---|---|
| Shell de escritorio | **Tauri 2** (Rust) | App nativa ligera para macOS, menú de barra, notificaciones, inicio automático, acceso a Keychain |
| UI | **React 19 + TypeScript + Vite** | Permite usar la skill `frontend-design` para una interfaz cuidada |
| Estilos | **Tailwind CSS** + tokens propios (§9) | |
| Componentes | **shadcn/ui** (Radix) adaptados a la paleta | |
| Gráficos | **Recharts** (barras, gauges, líneas) + **TradingView Lightweight Charts** (velas) | Lightweight Charts es open source (Apache 2.0) |
| Estado / caché | **TanStack Query** | |
| Base de datos | **SQLite** vía `tauri-plugin-sql`, en `~/Library/Application Support/<app>/` | Todo local |
| Validación | **Zod** (TS), **serde** (Rust) | |
| IA | **Claude API** (SDK oficial `@anthropic-ai/sdk`) | Modelo configurable en Ajustes |
| Tests | **Vitest** (TS), `cargo test` (Rust), **Playwright** para la UI | |
| Empaquetado | `tauri build` → `.app` / `.dmg` universal (Apple Silicon prioritario) | |

Plugins de Tauri previstos: `sql`, `http`, `notification`, `autostart`, `fs`, `dialog` (subida de archivos), `store`, `log`. Keychain mediante el crate `keyring`.

> Alternativa descartada: SwiftUI nativo. Se prefiere Tauri porque las skills de diseño disponibles en Claude Code trabajan sobre web/React. Si en el futuro se quiere 100 % nativo, la lógica de dominio en TS/Rust debe quedar desacoplada de la UI para facilitar el cambio.

---

## 4. Fuentes de datos

**Regla:** usar primero fuentes oficiales y gratuitas; las APIs comerciales solo como complemento y siempre detrás de una interfaz `DataProvider` intercambiable.

### 4.1 EE. UU.
- **SEC EDGAR** (gratuito, oficial):
  - `https://data.sec.gov/submissions/CIK##########.json` → lista de filings (10-K, 10-Q, 8-K, 20-F, 6-K).
  - `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` → datos financieros estructurados (XBRL).
  - Mapeo ticker→CIK: `https://www.sec.gov/files/company_tickers.json`.
  - **Obligatorio**: cabecera `User-Agent` con nombre y email del usuario (configurable en Ajustes) y respetar ≤10 peticiones/segundo.
- Emisores extranjeros en EE. UU. (ADR) usan **20-F / 6-K**: tratarlos como equivalentes anuales/intermedios.

### 4.2 Europa
- No existe un 10-Q uniforme. Equivalencias:
  - **10-K → Informe Financiero Anual** (formato **ESEF**, XBRL inline, NIIF/IFRS).
  - **10-Q → Informe semestral (H1)** y, si la empresa los publica, **informes/trading updates trimestrales (Q1/Q3)**.
- Regla: tomar los **3 últimos informes anuales** y los **3 últimos informes intermedios disponibles** (semestrales y/o trimestrales). Si solo hay semestrales, se usan los 3 últimos semestrales y se indica en la UI.
- Fuentes por orden de prioridad:
  1. **filings.xbrl.org** (API pública de presentaciones ESEF).
  2. Reguladores nacionales: **CNMV** (España), **AMF** (Francia), **Unternehmensregister** (Alemania), **AFM** (Países Bajos), **Consob/Borsa** (Italia), etc.
  3. Página de **Relación con Inversores** de la propia empresa (solo para localizar el documento, no para hacer scraping masivo).
- Mapeo ISIN→ticker/emisor: **OpenFIGI API** (gratuita con key opcional).

### 4.3 Precios, divisas, calendario y peers
- **Precio**: se consulta **una vez al abrir la app** (y con botón "Actualizar precios"). No hay streaming ni refresco por minuto.
- **Históricos** (para velas de largo plazo y valoración histórica): proveedor configurable (p. ej. Financial Modeling Prep, EODHD, Finnhub, Alpha Vantage o Stooq). Implementar el primero con plan gratuito y dejar la interfaz abierta.
- **Divisas**: tipos de cambio del **BCE** (p. ej. vía `frankfurter.app`). Todo el portfolio se consolida en EUR.
- **Calendario de resultados**: endpoint de earnings calendar del proveedor elegido + fechas deducidas del histórico de filings. Se guarda en SQLite.
- **Competidores (peers)**: endpoint de peers del proveedor + validación **una sola vez** por la IA (lista cacheada; el usuario puede editarla).
- **ETFs/ETCs**: ficha (TER, índice replicado, tipo de réplica, domicilio, tamaño, divisa, top holdings y reparto sectorial/geográfico si el proveedor lo ofrece). Ver §5.5.

### 4.4 Cuando no se encuentra un documento → "Solicitud al usuario"
Si la app no localiza un informe necesario, crea una **Solicitud** visible en una bandeja ("Documentos pendientes") con información **exacta**:

> *"Necesito el **Informe semestral H1 2026** de **Inditex (ITX.MC · ES0148396007)**, publicado aprox. en **septiembre 2026**. Formato preferido: **PDF o ZIP ESEF**. Dónde suele estar: web de inversores de la empresa o CNMV."*

- El usuario sube el archivo (arrastrar y soltar o diálogo).
- Si es **ESEF/XBRL** → parseo determinista.
- Si es **PDF** → extracción con Claude (entrada PDF) a un **esquema JSON estricto** de métricas; cada cifra extraída queda marcada como "extraída de PDF" con nº de página.
- El archivo se guarda localmente y la solicitud se cierra.

---

## 5. Secciones de la app

Navegación lateral con 4 secciones + Ajustes:

### 5.1 Watchlist — "Equity Analyst"
Lista de acciones que añade el usuario (Ticker o ISIN). Por cada una, ficha con **deep dive resumido**:

1. **Modelo de negocio** — qué vende, a quién, cómo gana dinero, segmentos y geografías (IA, 4–6 líneas).
2. **Financieros** (determinista, de los 3 10-K + 3 10-Q o equivalentes):
   - Crecimiento de ventas y beneficio (anual y último intermedio vs. mismo periodo del año anterior).
   - Márgenes (bruto, operativo, neto) y su tendencia.
   - Deuda: deuda neta, años necesarios para pagarla con su caja generada.
   - Flujo de caja: caja operativa, inversión (capex), **caja libre** y su conversión respecto al beneficio.
3. **Forward outlook** — guidance de la empresa y lo que dicen los propios informes (IA, citando el documento).
4. **Valoración vs. su propia historia** — múltiplos actuales vs. su media de 5 y 10 años + precio actual vs. rango histórico.
5. **Catalizadores** y **Riesgos** — listas breves (IA, basadas en los informes, sección de riesgos incluida).
6. **Comparativa con competidores** (3–4 peers más cercanos): crecimiento, márgenes, valoración, deuda y caja en una tabla y gráfico simples. Veredicto:
   - **Barata / Justa / Cara vs. competencia**.
   - **¿Oportunidad o trampa de valor?** (ver reglas en §8.3).

### 5.2 Mi Portfolio
- El usuario introduce **operaciones**: fecha, ticker/ISIN, tipo (acción/ETF/ETC), cantidad, precio, divisa, comisiones, bróker (opcional). También ventas y dividendos (opcional en v1).
- Cálculos: precio medio de compra, valor actual, rentabilidad (€ y %), rentabilidad anualizada, peso en cartera, exposición por sector, país y divisa.
- **Primer paso por cada acción**: localizar y analizar sus informes (mismo análisis que §5.1).
- **Vision board**: vista visual tipo tablero con tarjetas de cada posición (rentabilidad, termómetro de valoración, salud financiera) + gráfico de composición + proyección cualitativa de comportamiento a largo plazo (escenarios prudente/base/optimista basados en crecimiento histórico, claramente etiquetados como escenarios, no predicciones).
- **Recomendación por posición**: **Comprar más** o **Mantener** (el objetivo es hacer crecer la cartera). Basada en: valoración por fundamentales, riesgos, precio y **equilibrio de la cartera** (no sobreconcentrar). Si hay alertas serias se muestra **"Mantener — vigilar"** con el motivo; la app nunca oculta un riesgo relevante.

### 5.3 Riesgo técnico de largo plazo
- Toma **todos los tickers guardados** (watchlist + portfolio).
- Gráfico de **velas mensuales** (por defecto, 10 años) con opción de **velas semanales** sobre 3–5 años. **Nunca intradía ni análisis de horizonte semanal.**
- Indicadores simples, explicados en llano:
  - Media de 200 sesiones / 40 semanas / 10 meses: ¿la tendencia de fondo es alcista, lateral o bajista?
  - Caída desde máximos (drawdown) actual y máxima histórica.
  - Soportes y resistencias de largo plazo.
  - Volatilidad a largo plazo ("cuánto suele moverse en un año malo").
- Resultado: **semáforo de riesgo técnico** (Bajo / Medio / Alto) con una frase explicativa por ticker.

### 5.4 Estrellas ⭐
- **Watchlist**: una estrella al ticker con **mejor puntuación de valoración + calidad** y que **mejor complemente la cartera actual** (aporta diversificación de sector/país/divisa y baja correlación con lo que ya hay).
- **Portfolio**: una estrella a la posición que, **si se comprase hoy, estaría más barata** según sus fundamentales (descuento vs. su historia y vs. peers, con calidad mínima exigida para no premiar trampas de valor).
- Debe mostrarse **por qué** tiene la estrella (tooltip con 2–3 razones).

### 5.5 ETFs y ETCs
No tienen 10-K/10-Q propios. Tratamiento:
- **ETF de acciones**: valoración agregada si el proveedor la da (beneficios agregados del índice), TER, diversificación, solapamiento con otras posiciones de la cartera.
- **ETC (materias primas)**: sin fundamentales de empresa; mostrar TER, colateral/estructura, precio vs. su media histórica de largo plazo y papel en la cartera (cobertura, diversificación).
- La recomendación Comprar más/Mantener se basa en el **equilibrio de la cartera** y en la tendencia de largo plazo, y se indica explícitamente que no hay análisis de estados financieros.

### 5.6 Ajustes
API keys (Keychain), modelo de IA, presupuesto mensual de IA, email para el User-Agent de la SEC, proveedor de precios, divisa base, idioma, inicio automático, frecuencia de comprobación de nuevos informes.

---

## 6. Visualización "para no expertos"

La pantalla principal de cada acción tiene **4 indicadores visuales grandes**, comprensibles sin saber de bolsa:

| Indicador | Visual | Cómo se explica en la UI |
|---|---|---|
| **¿Cara o barata?** | Termómetro / gauge (Barata · Justa · Cara) | "Hoy pagas **18 años** de beneficios. Su media de 5 años es **24**. Está más barata que de costumbre." |
| **¿Genera caja?** | Barras de caja libre de los últimos años | "Por cada **100 €** que inviertes, la empresa genera **5 €** de caja libre al año." |
| **¿Tiene mucha deuda?** | Barra Baja · Moderada · Alta | "Podría pagar toda su deuda en **1,5 años** con la caja que genera." |
| **¿Crece?** | Línea de ventas y beneficio | "Vende un **12 % más** que hace un año." |

Reglas:
- Ratios técnicos (PER, EV/EBITDA, FCF yield, deuda neta/EBITDA, ROIC…) **solo en una sección plegable "Detalle para expertos"**, con nombre técnico y explicación.
- Colores semánticos coherentes en toda la app (verde = favorable, ámbar = neutral, rojo = desfavorable), **nunca el color como única señal** (añadir texto o icono).
- Cada número con tooltip de origen (§2.2).

---

## 7. Uso de la IA (Claude API) — política de coste

- **Nunca** se llama a la IA al abrir la app, al refrescar precios ni al navegar.
- Se llama **solo** cuando:
  1. Aparece un **informe nuevo** (detectado por el calendario/comprobación) → re-análisis de ese ticker.
  2. Se **añade un ticker nuevo** → análisis inicial.
  3. El usuario pulsa **"Re-analizar"** explícitamente.
  4. Hay que **extraer datos de un PDF** subido por el usuario.
- **Caché** por clave `(ticker, id_documento, versión_prompt)`. Si no cambia nada, no se vuelve a llamar.
- Se envía a la IA un **resumen numérico ya calculado** + extractos relevantes de los informes (p. ej. secciones MD&A y Risk Factors), no documentos completos salvo en extracción de PDF.
- Usar **prompt caching** para instrucciones de sistema largas.
- Modelo configurable en Ajustes (por defecto: `claude-sonnet-5-5` para análisis y `claude-haiku-5-5` para extracción/clasificación; `claude-opus-5-5` opcional para análisis más profundos).
- **Presupuesto mensual** configurable con contador de tokens/coste en Ajustes; si se supera, la app pide confirmación antes de cada llamada.
- Salida de la IA siempre en **JSON validado** (veredicto, puntos clave, riesgos, catalizadores, citas a documento/página).
- Prompts versionados en `/prompts/*.md`, nunca incrustados como strings sueltos en el código.

### Calendario y autonomía
- Tarea en segundo plano (la app queda en la **barra de menús** al cerrar la ventana; inicio automático opcional):
  - **1 vez al día**: actualiza calendario de resultados y comprueba EDGAR / filings.xbrl.org para tickers con fecha de resultados reciente o próxima.
  - Si detecta un informe nuevo → **notificación de macOS**: "Ha salido el 10-Q de Q3 2026 de NVDA. ¿Analizar ahora?" (la IA se ejecuta al aceptar o según Ajustes: automático/manual).
- Vista **Calendario** con próximos resultados de todos los tickers guardados.

---

## 8. Lógica de puntuación (determinista, transparente)

Todas las puntuaciones 0–100, con desglose visible. Pesos en `src/domain/scoring/config.ts` para poder ajustarlos.

### 8.1 Puntuación de valoración (vs. su historia)
- Múltiplos actuales (precio/beneficio, precio/caja libre, EV/EBIT) vs. su mediana de 5 y 10 años.
- Precio actual vs. rango histórico.
- Resultado → **Barata** (< −15 % vs. mediana), **Justa** (±15 %), **Cara** (> +15 %). Umbrales configurables.

### 8.2 Puntuación de calidad / salud financiera
Crecimiento (ventas, beneficio), estabilidad y tendencia de márgenes, conversión de beneficio en caja, nivel de deuda, dilución de acciones.

### 8.3 Veredicto vs. competencia y "¿oportunidad o trampa?"
- Comparar valoración y calidad contra la **mediana de los 3–4 peers**.
- **Trampa de valor** si está barata **y** se cumplen ≥2 de: ventas cayendo, márgenes empeorando de forma sostenida, deuda creciendo, caja libre negativa o en caída, dilución relevante.
- **Oportunidad** si está barata vs. historia y peers **y** la calidad es igual o superior a la mediana de peers.
- En otro caso: "Justa" con explicación.

### 8.4 Recomendación de cartera (Comprar más / Mantener)
Combina valoración, calidad, riesgo técnico de largo plazo (§5.3) y **peso en cartera** (penalizar si una posición ya supera un % máximo configurable, por defecto 15 %, o si un sector supera el 35 %).

### 8.5 Estrellas
- Watchlist: `valoración × calidad × complemento_cartera` (diversificación sector/país/divisa + baja correlación de precios a largo plazo).
- Portfolio: mayor descuento de valoración con calidad ≥ umbral mínimo.

---

## 9. Diseño visual

**Antes de construir cualquier pantalla, carga y sigue la skill `frontend-design`** (y cualquier otra skill de diseño instalada en Claude Code).

Estética inspirada en la paleta cálida y editorial de Claude/Anthropic, **sin usar logotipos, nombres ni marcas de Anthropic** (la app tiene nombre e icono propios).

### Paleta (tokens CSS en `:root`, con modo oscuro)
| Token | Claro | Uso |
|---|---|---|
| `--bg` | `#FAF9F5` | Fondo principal (marfil) |
| `--surface` | `#F0EEE6` | Tarjetas, paneles |
| `--text` | `#191919` | Texto principal |
| `--text-muted` | `#6B6A65` | Texto secundario |
| `--accent` | `#CC785C` | Acento principal (terracota/arcilla) |
| `--accent-soft` | `#D4A27F` | Acento secundario |
| `--sand` | `#EBDBBC` | Destacados suaves |
| `--positive` | `#5A8A5E` | Favorable |
| `--warning` | `#C99A3B` | Neutral / atención |
| `--negative` | `#B5523B` | Desfavorable |

Modo oscuro: fondo `#1F1E1D`, superficie `#2A2927`, texto `#F0EEE6`; respeta `prefers-color-scheme` y permite forzarlo en Ajustes.

### Tipografía
- Titulares: serif editorial libre (**Source Serif 4** o **Newsreader**).
- Interfaz: sans limpia (**Inter**).
- Cifras: tabulares (`font-variant-numeric: tabular-nums`) o **JetBrains Mono** en tablas.
- Fuentes **incluidas en el bundle** (la app debe funcionar sin conexión).

### Principios de interfaz
- Mucho aire, esquinas redondeadas suaves, sombras mínimas, jerarquía clara.
- Sidebar nativa estilo macOS (translucidez/vibrancy de Tauri si es viable).
- Animaciones sutiles (≤200 ms), sin efectos llamativos.
- Estados vacíos cuidados ("Añade tu primer ticker"), estados de carga con skeletons y errores en lenguaje llano.
- Accesible: contraste AA, navegación por teclado, atajos ⌘K (buscar ticker), ⌘N (nueva operación), ⌘R (actualizar precios).

---

## 10. Estructura del proyecto

```
/
├── CLAUDE.md
├── prompts/                  # Prompts versionados para Claude (equity-analysis.md, pdf-extraction.md, peers.md…)
├── src/                      # Frontend React + TS
│   ├── app/                  # Rutas / layout / sidebar
│   ├── features/
│   │   ├── watchlist/
│   │   ├── portfolio/
│   │   ├── technical-risk/
│   │   ├── calendar/
│   │   ├── document-requests/
│   │   └── settings/
│   ├── domain/               # Lógica pura y testeable (sin UI)
│   │   ├── fundamentals/     # Normalización US-GAAP / IFRS a un modelo común
│   │   ├── valuation/
│   │   ├── scoring/
│   │   ├── portfolio/
│   │   └── technical/
│   ├── data/                 # Providers: sec-edgar, esef, openfigi, prices, fx, calendar, claude
│   ├── db/                   # Esquema SQLite y migraciones
│   ├── components/ui/        # Componentes base con tokens
│   └── styles/tokens.css
├── src-tauri/                # Rust: comandos, tareas en segundo plano, Keychain, notificaciones
└── tests/
    └── fixtures/             # Datos de prueba ETIQUETADOS como ficticios o filings reales descargados
```

### Modelo de datos (mínimo)
`securities` (ticker, isin, cik, nombre, tipo, mercado, divisa, sector, país) · `filings` (security_id, tipo, periodo, fecha, fuente, url/archivo, hash) · `financial_facts` (security_id, filing_id, concepto, valor, unidad, periodo, origen) · `prices` · `fx_rates` · `peers` · `transactions` · `analyses` (security_id, filing_ids, modelo, versión_prompt, json, fecha, coste) · `earnings_calendar` · `document_requests` · `ai_usage`.

### Normalización contable
Crear un **modelo común** de conceptos (ventas, beneficio bruto, EBIT, beneficio neto, caja operativa, capex, caja, deuda financiera, nº acciones…) con **mapeos** desde etiquetas US-GAAP y IFRS/ESEF. Documentar cada mapeo y registrar cuando un concepto no se encuentra.

---

## 11. Plan de fases

Avanzar fase a fase; al terminar cada una, ejecutar tests, mostrar la app funcionando y esperar validación del usuario.

1. **Esqueleto**: Tauri + React + tokens de diseño + sidebar con las 4 secciones vacías + Ajustes con Keychain + SQLite.
2. **EE. UU. – datos**: ticker→CIK, descarga de submissions y companyfacts, normalización, 3 10-K + 3 10-Q, precio al abrir.
3. **Ficha de acción**: 4 indicadores visuales (§6) + detalle financiero + valoración vs. historia.
4. **IA**: análisis narrativo con caché, presupuesto y JSON validado.
5. **Peers** y veredicto oportunidad/trampa.
6. **Europa**: ISIN/OpenFIGI, ESEF, bandeja de "Documentos pendientes" y extracción de PDF.
7. **Portfolio**: operaciones, rentabilidad en EUR, vision board, recomendaciones, ETFs/ETCs.
8. **Riesgo técnico de largo plazo** con velas mensuales/semanales.
9. **Estrellas ⭐**.
10. **Autonomía**: calendario, comprobación diaria, notificaciones, barra de menús, inicio automático.
11. **Pulido**: diseño final con skills, modo oscuro, accesibilidad, `.dmg`.

---

## 12. Convenciones de trabajo para Claude Code

- TypeScript `strict`; sin `any` salvo justificado.
- Lógica de dominio pura y con tests unitarios (especialmente `valuation`, `scoring`, `portfolio`, normalización contable).
- Tests de integración con **filings reales** guardados en `tests/fixtures/` (p. ej. un 10-K de una empresa grande de EE. UU. y un ESEF de una empresa europea).
- Commits pequeños y descriptivos (Conventional Commits).
- Cualquier dependencia nueva: justificarla brevemente.
- Respetar términos de uso y límites de cada API; nada de scraping agresivo.
- Logs sin datos sensibles ni API keys.
- Si falta información para decidir algo con impacto (fuente de datos de pago, cambio de stack, umbrales de scoring), **preguntar al usuario** en lugar de asumir.
- Comandos habituales:
  - `npm run tauri dev` — desarrollo
  - `npm run test` — tests TS
  - `cd src-tauri && cargo test` — tests Rust
  - `npm run tauri build` — build de producción
