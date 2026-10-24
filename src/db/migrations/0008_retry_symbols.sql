-- Los símbolos de precio marcados «no encontrado» se vuelven a buscar: el buscador
-- europeo ahora acepta otra bolsa con la misma divisa y el mismo nombre.
UPDATE securities SET price_symbol = NULL WHERE price_symbol LIKE '%:!%';
