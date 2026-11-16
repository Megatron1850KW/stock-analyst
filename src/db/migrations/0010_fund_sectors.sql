-- Reparto por sectores de los fondos de la cartera, dado a mano por el usuario
-- el 16-11-2026 (fichas de las gestoras). Se guarda una vez en su ficha para la
-- exposición por sectores y «El experto te dice cosas»; no se vuelve a consultar.
-- Solo toca los fondos que existan; en una base sin ellos no hace nada.

-- Fondos sin ficha todavía: una ficha mínima, editable después en la app
INSERT OR IGNORE INTO fund_profiles (security_id, profile_json, origin, edited_at)
SELECT id,
  '{"ter":null,"index":null,"replication":null,"domicile":null,"aumMillions":null,"aumCurrency":null,"fundCurrency":null,"distribution":null,"collateral":null,"holdings":[],"sectors":[],"countries":[],"asOf":null,"pages":{},"notes":[]}',
  'user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM securities
WHERE isin IN ('IE00B3XXRP09', 'IE000COQKPO9', 'IE000I8KRLL9', 'DE000A2T0VU5', 'IE00BDFL4P12')
   OR (kind = 'etf' AND upper(name) LIKE '%AMUNDI%' AND (upper(name) LIKE '%SWITZERLAND%' OR upper(name) LIKE '%SWISS%'));

-- Vanguard S&P 500 (VUSA)
UPDATE fund_profiles SET origin = 'user', edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  profile_json = json_set(profile_json, '$.sectors', json('[
    {"key":"Tecnología","weight":0.3971},{"key":"Finanzas","weight":0.114},{"key":"Comunicaciones","weight":0.0995},
    {"key":"Salud","weight":0.0926},{"key":"Consumo discrecional","weight":0.086},{"key":"Industria","weight":0.0805},
    {"key":"Consumo básico","weight":0.0444},{"key":"Energía","weight":0.034},{"key":"Servicios públicos","weight":0.0188},
    {"key":"Inmobiliario","weight":0.017},{"key":"Materiales","weight":0.0162}]'))
WHERE security_id IN (SELECT id FROM securities WHERE isin = 'IE00B3XXRP09');

-- Invesco NASDAQ-100 ESG (N1ES) e iShares Global Semiconductors (SEC0): tecnología
UPDATE fund_profiles SET origin = 'user', edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  profile_json = json_set(profile_json, '$.sectors', json('[{"key":"Tecnología","weight":1}]'))
WHERE security_id IN (SELECT id FROM securities WHERE isin IN ('IE000COQKPO9', 'IE000I8KRLL9'));

-- Xtrackers Physical Gold (XGDU) e iShares Diversified Commodity (SXRS): materias primas
UPDATE fund_profiles SET origin = 'user', edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  profile_json = json_set(profile_json, '$.sectors', json('[{"key":"Materias primas","weight":1}]'))
WHERE security_id IN (SELECT id FROM securities WHERE isin IN ('DE000A2T0VU5', 'IE00BDFL4P12'));

-- Amundi MSCI Switzerland
UPDATE fund_profiles SET origin = 'user', edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  profile_json = json_set(profile_json, '$.sectors', json('[
    {"key":"Salud","weight":0.4047},{"key":"Finanzas","weight":0.1964},{"key":"Consumo básico","weight":0.1379},
    {"key":"Industria","weight":0.113},{"key":"Materiales","weight":0.0636},{"key":"Consumo discrecional","weight":0.0595},
    {"key":"Comunicaciones","weight":0.0105},{"key":"Tecnología","weight":0.0069},{"key":"Inmobiliario","weight":0.0061},
    {"key":"Otros","weight":0.0014}]'))
WHERE security_id IN (SELECT id FROM securities WHERE kind = 'etf' AND upper(name) LIKE '%AMUNDI%' AND (upper(name) LIKE '%SWITZERLAND%' OR upper(name) LIKE '%SWISS%'));
