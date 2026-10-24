-- Fase 2: datos de la SEC.

ALTER TABLE securities ADD COLUMN sic TEXT;
ALTER TABLE securities ADD COLUMN sic_description TEXT;
ALTER TABLE securities ADD COLUMN fiscal_year_end TEXT;     -- MMDD, p. ej. 0928
ALTER TABLE securities ADD COLUMN filer_type TEXT CHECK (filer_type IN ('domestic', 'foreign'));
ALTER TABLE securities ADD COLUMN reporting_currency TEXT;  -- divisa de los estados financieros

-- Conceptos del modelo común que no aparecen en un informe (CLAUDE.md §10:
-- "registrar cuando un concepto no se encuentra"). La UI los muestra como "Sin dato".
CREATE TABLE concept_gaps (
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  filing_id       INTEGER NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
  concept         TEXT NOT NULL,
  checked_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (filing_id, concept)
);

CREATE INDEX financial_facts_filing ON financial_facts(filing_id);
