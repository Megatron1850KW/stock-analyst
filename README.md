# Agente Financiero

Analista financiero personal para macOS (Tauri 2 + React 19). La especificación completa está en [CLAUDE.md](CLAUDE.md).

**Estado:** fase 2 — acciones de EE. UU. con datos oficiales de la SEC (3 últimos 10-K y 10-Q) y precio al abrir la app.

## Primeros pasos en la app

1. **Ajustes › Identificación ante la SEC**: tu nombre y email (la SEC lo exige en cada consulta).
2. **Ajustes › Claves de API › Proveedor de precios**: tu clave de Financial Modeling Prep (plan gratuito).
3. **Watchlist**: escribe un ticker (AAPL, MSFT…) y pulsa Añadir.

## Requisitos en el Mac

1. Herramientas de línea de comandos de Xcode: `xcode-select --install`
2. Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
3. Node.js 22 o superior (p. ej. `brew install node`)

## Uso

```bash
npm install
npm run tauri dev      # abre la app en modo desarrollo
npm run tauri build    # genera .app y .dmg en src-tauri/target/release/bundle/
```

## Cómo fluyen los datos

- Las peticiones a la SEC y a FMP las hace Rust (`src-tauri/src/sec.rs`, `prices.rs`): User-Agent obligatorio, ≤10 peticiones/s a la SEC y la clave de precios leída del Llavero.
- El frontend valida cada respuesta con Zod (`src/data/`), la normaliza al modelo común (`src/domain/fundamentals/concepts.ts`, con los mapeos documentados) y la guarda en SQLite con su origen.

## Tests

```bash
npm run test           # Vitest: formato, ajustes, esquema SQLite y UI
npm run test:ui        # Playwright: la UI con el lado Rust simulado y datos ficticios
cd src-tauri && cargo test
```

## Dónde se guardan los datos

- Base de datos y ajustes: `~/Library/Application Support/es.agentefinanciero.app/`
- Claves de API: Llavero de macOS, servicio `es.agentefinanciero.app`

> Herramienta informativa, no constituye asesoramiento financiero.
