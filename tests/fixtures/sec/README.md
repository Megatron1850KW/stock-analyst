# Datos REALES de la SEC

Descargados de SEC EDGAR el 24-10-2026 en el Mac de Pablo con
`tests/fixtures/fetch-real.mjs`:

- `*-submissions.json`: respuesta completa de `data.sec.gov/submissions`.
- `*-companyfacts.json`: `companyfacts` recortado a las etiquetas XBRL del
  modelo común y a 10-K/10-Q/20-F/40-F presentados desde 2013 (incluye la
  historia de 10 años para valorar frente a la propia historia).
- `*-informe.md`: tabla legible de lo que importó la app en la fase 2.

Los usa `tests/unit/sec-real-offline.test.ts` para comprobar sin conexión
que la importación y los cálculos dan las mismas cifras que publica la SEC.
