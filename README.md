# Agente Financiero

Analista financiero personal para macOS (Tauri 2 + React 19). La especificación completa está en [CLAUDE.md](CLAUDE.md).

**Estado:** fase 1 (esqueleto) — portada con logo animado, secciones en columnas, Ajustes con Llavero y base de datos SQLite.

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

## Tests

```bash
npm run test           # Vitest: formato, ajustes, esquema SQLite y UI
npm run test:ui        # Playwright sobre la vista previa en navegador
cd src-tauri && cargo test
```

## Dónde se guardan los datos

- Base de datos y ajustes: `~/Library/Application Support/es.agentefinanciero.app/`
- Claves de API: Llavero de macOS, servicio `es.agentefinanciero.app`

> Herramienta informativa, no constituye asesoramiento financiero.
