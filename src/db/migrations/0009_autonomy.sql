-- Fase 10 (autonomía): informes nuevos detectados por la comprobación diaria
-- y estado de la app (última comprobación).

CREATE TABLE new_reports (
  id              INTEGER PRIMARY KEY,
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  form_type       TEXT NOT NULL,
  period_type     TEXT NOT NULL CHECK (period_type IN ('annual', 'interim')),
  period_end      TEXT NOT NULL,
  filed_at        TEXT,
  accession_no    TEXT NOT NULL,
  label           TEXT NOT NULL,
  source          TEXT NOT NULL,
  url             TEXT,
  detected_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'analyzed', 'dismissed')),
  UNIQUE (security_id, accession_no)
);

CREATE TABLE app_state (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
