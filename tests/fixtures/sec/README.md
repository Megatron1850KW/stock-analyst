# Datos REALES de la SEC

Descargados de SEC EDGAR el 24-10-2026 con `tests/integration/sec-real.test.ts`
(ejecutado en el Mac de Pablo):

- `*-submissions.json`: respuesta completa de `data.sec.gov/submissions`.
- `*-companyfacts.json`: `companyfacts` recortado a los 6 informes elegidos.
- `*-informe.md`: tabla legible de lo que importó la app en esa ejecución
  (anterior a la corrección de los conceptos de deuda).

Los usa `tests/unit/sec-real-offline.test.ts` para comprobar sin conexión
que la importación sigue dando las mismas cifras que publica la SEC.
