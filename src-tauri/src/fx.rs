//! Tipos de cambio de referencia del BCE (CLAUDE.md §4.3) a través de
//! Frankfurter, gratuito y sin clave. Base siempre EUR. Se piden al abrir la
//! app o con «Actualizar precios», solo desde la última fecha guardada.

use crate::http::{client, get_text, NetError, Throttle};
use crate::prices::validate_date;
use std::time::Duration;

const HOST: &str = "api.frankfurter.dev";
static THROTTLE: Throttle = Throttle::new(Duration::from_millis(500));

/// Divisas separadas por comas: códigos ISO de 3 letras (USD,GBP,CHF…).
pub fn validate_symbols(symbols: &str) -> Result<&str, NetError> {
    let ok = !symbols.is_empty()
        && symbols.len() <= 120
        && symbols.split(',').all(|c| c.len() == 3 && c.bytes().all(|b| b.is_ascii_uppercase()));
    if ok { Ok(symbols) } else { Err(NetError::Invalid(format!("Divisas no válidas: {symbols}"))) }
}

/// Serie diaria de tipos EUR→divisa desde `from` hasta hoy.
#[tauri::command]
pub async fn fx_series(from: String, symbols: String) -> Result<String, NetError> {
    let from = validate_date(&from)?;
    let symbols = validate_symbols(&symbols)?;
    THROTTLE.wait().await;
    let req = client()
        .get(format!("https://api.frankfurter.dev/v1/{from}.."))
        .query(&[("base", "EUR"), ("symbols", symbols)]);
    get_text(HOST, req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valida_divisas() {
        assert!(validate_symbols("USD").is_ok());
        assert!(validate_symbols("USD,GBP,CHF").is_ok());
        assert!(validate_symbols("usd").is_err());
        assert!(validate_symbols("USD,").is_err());
        assert!(validate_symbols("USD&x=1").is_err());
        assert!(validate_symbols("").is_err());
    }
}
