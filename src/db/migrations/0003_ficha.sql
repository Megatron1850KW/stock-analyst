-- Fase 3: histórico de informes anuales, splits e informes subidos por el usuario.

-- core: los 3 anuales + 3 intermedios del análisis; history: anuales antiguos
-- (solo para valorar frente a su propia historia); upload: subidos por el usuario.
ALTER TABLE filings ADD COLUMN role TEXT NOT NULL DEFAULT 'core' CHECK (role IN ('core', 'history', 'upload'));
ALTER TABLE filings ADD COLUMN bytes INTEGER;
ALTER TABLE filings ADD COLUMN original_name TEXT;

-- Desdoblamientos (splits) para comparar precios y beneficios por acción de distintas épocas.
CREATE TABLE splits (
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  numerator       REAL NOT NULL CHECK (numerator > 0),
  denominator     REAL NOT NULL CHECK (denominator > 0),
  source          TEXT NOT NULL,
  fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (security_id, date)
);

CREATE INDEX document_requests_security ON document_requests(security_id, status);
