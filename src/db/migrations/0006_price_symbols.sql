-- Fase 6: símbolo de cada valor en su proveedor de precios (bolsas europeas).
-- Formato «proveedor:símbolo» (alphavantage:ITX.MC); «proveedor:!AAAA-MM-DD» si
-- el proveedor no lo cubre (se vuelve a buscar pasado un mes, para no gastar consultas).
ALTER TABLE securities ADD COLUMN price_symbol TEXT;
