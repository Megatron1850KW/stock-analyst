-- Fase 6: acciones europeas (CLAUDE.md §4.2)
ALTER TABLE securities ADD COLUMN lei TEXT;   -- identificador de la entidad (GLEIF), clave en filings.xbrl.org
CREATE INDEX securities_lei ON securities(lei) WHERE lei IS NOT NULL;
