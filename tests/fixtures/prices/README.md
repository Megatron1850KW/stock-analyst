# Precios REALES (Tiingo)

Descargados el 24-10-2026 en el Mac de Pablo con `tests/fixtures/fetch-real.mjs`
(`api.tiingo.com/tiingo/daily/<ticker>/prices`, sin ajustar y con el factor de
split de cada día). No contienen ninguna clave.

- `*-quote.json`: último día (cierre del 23-10-2026).
- `*-history.json`: diario desde el 2-1-2015. GOOG incluye el split 20×1 del 18-7-2022.

Los usa el simulador de Tauri de los tests de UI (`tests/e2e/tauri-mock.ts`).
