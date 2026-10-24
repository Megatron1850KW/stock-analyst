-- Esquema inicial (CLAUDE.md §10 "Modelo de datos").
-- Toda cifra guarda su origen: fuente, documento, periodo y fecha de obtención (§2.2).
-- Fechas en ISO 8601 (TEXT). Importes en la unidad/divisa indicada en la propia fila.

PRAGMA foreign_keys = ON;

CREATE TABLE securities (
  id            INTEGER PRIMARY KEY,
  ticker        TEXT,
  isin          TEXT,
  cik           TEXT,
  figi          TEXT,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('stock', 'etf', 'etc')),
  market        TEXT,
  exchange      TEXT,
  currency      TEXT NOT NULL,
  sector        TEXT,
  industry      TEXT,
  country       TEXT,
  in_watchlist  INTEGER NOT NULL DEFAULT 0 CHECK (in_watchlist IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ticker IS NOT NULL OR isin IS NOT NULL)
);
CREATE UNIQUE INDEX securities_isin ON securities(isin) WHERE isin IS NOT NULL;
CREATE UNIQUE INDEX securities_ticker_exchange ON securities(ticker, exchange) WHERE ticker IS NOT NULL;

CREATE TABLE filings (
  id              INTEGER PRIMARY KEY,
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  form_type       TEXT NOT NULL,          -- 10-K, 10-Q, 20-F, 6-K, ESEF-AFR, H1, Q1, Q3...
  period_type     TEXT NOT NULL CHECK (period_type IN ('annual', 'interim')),
  period_end      TEXT NOT NULL,
  fiscal_year     INTEGER,
  fiscal_period   TEXT,                   -- FY, Q1, Q2, Q3, H1
  filed_at        TEXT,
  source          TEXT NOT NULL,          -- sec-edgar, filings.xbrl.org, cnmv, user-upload...
  accession_no    TEXT,                   -- nº de accession de la SEC u otro id oficial
  url             TEXT,
  local_path      TEXT,
  content_hash    TEXT,
  fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (security_id, source, accession_no)
);
CREATE INDEX filings_security_period ON filings(security_id, period_end);

CREATE TABLE financial_facts (
  id              INTEGER PRIMARY KEY,
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  filing_id       INTEGER REFERENCES filings(id) ON DELETE CASCADE,
  concept         TEXT NOT NULL,          -- concepto del modelo común (revenue, net_income...)
  source_tag      TEXT,                   -- etiqueta original US-GAAP / IFRS
  value           REAL NOT NULL,
  unit            TEXT NOT NULL,          -- USD, EUR, shares, USD/shares...
  period_start    TEXT,
  period_end      TEXT NOT NULL,
  origin          TEXT NOT NULL CHECK (origin IN ('xbrl', 'esef', 'pdf-extraction', 'user')),
  page            INTEGER,                -- página del PDF si origin = 'pdf-extraction'
  fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX financial_facts_lookup ON financial_facts(security_id, concept, period_end);

CREATE TABLE prices (
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  interval        TEXT NOT NULL CHECK (interval IN ('1d', '1w', '1mo')),
  open            REAL,
  high            REAL,
  low             REAL,
  close           REAL NOT NULL,
  adj_close       REAL,
  volume          REAL,
  currency        TEXT NOT NULL,
  source          TEXT NOT NULL,
  fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (security_id, interval, date)
);

CREATE TABLE fx_rates (
  date            TEXT NOT NULL,
  base            TEXT NOT NULL,
  quote           TEXT NOT NULL,
  rate            REAL NOT NULL CHECK (rate > 0),
  source          TEXT NOT NULL,          -- p. ej. ecb via frankfurter.app
  fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (date, base, quote)
);

CREATE TABLE peers (
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  peer_id         INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('provider', 'ai-validated', 'user')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (security_id, peer_id),
  CHECK (security_id <> peer_id)
);

CREATE TABLE transactions (
  id              INTEGER PRIMARY KEY,
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE RESTRICT,
  trade_date      TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('buy', 'sell', 'dividend')),
  quantity        REAL NOT NULL CHECK (quantity >= 0),
  price           REAL NOT NULL CHECK (price >= 0),
  currency        TEXT NOT NULL,
  fees            REAL NOT NULL DEFAULT 0 CHECK (fees >= 0),
  fx_rate_to_base REAL,
  broker          TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX transactions_security ON transactions(security_id, trade_date);

CREATE TABLE analyses (
  id              INTEGER PRIMARY KEY,
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  filing_ids      TEXT NOT NULL,          -- JSON array de filings.id usados
  cache_key       TEXT NOT NULL UNIQUE,   -- (ticker, id_documento, versión_prompt)
  model           TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  result_json     TEXT NOT NULL,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cost_eur        REAL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE earnings_calendar (
  id              INTEGER PRIMARY KEY,
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  expected_date   TEXT NOT NULL,
  fiscal_period   TEXT,
  source          TEXT NOT NULL CHECK (source IN ('provider', 'inferred', 'user')),
  confirmed       INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (security_id, expected_date)
);

CREATE TABLE document_requests (
  id              INTEGER PRIMARY KEY,
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  document_type   TEXT NOT NULL,          -- p. ej. "Informe semestral H1 2026"
  period          TEXT NOT NULL,
  expected_date   TEXT,
  preferred_format TEXT,
  where_to_find   TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'dismissed')),
  filing_id       INTEGER REFERENCES filings(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at     TEXT
);

CREATE TABLE ai_usage (
  id              INTEGER PRIMARY KEY,
  analysis_id     INTEGER REFERENCES analyses(id) ON DELETE SET NULL,
  purpose         TEXT NOT NULL CHECK (purpose IN ('analysis', 'pdf-extraction', 'peers', 'other')),
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cost_eur        REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ai_usage_month ON ai_usage(created_at);
