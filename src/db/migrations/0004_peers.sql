-- Fase 5: competidores. La IA los propone una sola vez por valor; la propuesta
-- se guarda (con lo descartado y por qué) y el usuario puede editar la lista.
CREATE TABLE peer_proposals (
  security_id     INTEGER PRIMARY KEY REFERENCES securities(id) ON DELETE CASCADE,
  model           TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  result_json     TEXT NOT NULL,
  cost_eur        REAL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Por qué es competidor (frase de la IA o «añadido por ti»).
ALTER TABLE peers ADD COLUMN reason TEXT;
CREATE INDEX peers_peer ON peers(peer_id);
