-- Fase 7: cartera.
-- De dónde sale el sector de un valor: 'sic' (código SIC de la SEC), 'user' (lo
-- indicaste tú) o 'factsheet' (ficha del ETF). Sin sector se muestra «Sin dato».
ALTER TABLE securities ADD COLUMN sector_source TEXT;

-- Ficha de un ETF o ETC (CLAUDE.md §5.5), leída por la IA de la ficha o KID en
-- PDF que subes, o escrita/corregida por ti. `profile_json` sigue el esquema de
-- src/features/portfolio/fund-profile.ts; cada cifra lleva su página.
CREATE TABLE fund_profiles (
  security_id     INTEGER PRIMARY KEY REFERENCES securities(id) ON DELETE CASCADE,
  profile_json    TEXT NOT NULL,
  origin          TEXT NOT NULL CHECK (origin IN ('pdf-extraction', 'user')),
  doc_path        TEXT,
  doc_name        TEXT,
  doc_sha256      TEXT,
  model           TEXT,
  prompt_version  TEXT,
  cost_eur        REAL,
  extracted_at    TEXT,
  edited_at       TEXT
);
