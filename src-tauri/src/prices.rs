//! Cotizaciones (CLAUDE.md §4.3): se piden una vez al abrir la app o con
//! «Actualizar precios». Proveedor elegido por el usuario: Financial Modeling
//! Prep (plan gratuito). La clave se lee del Llavero y nunca sale de Rust.

use crate::http::{client, get_text, NetError, Throttle};
use crate::secrets;
use std::time::Duration;

const FMP_HOST: &str = "financialmodelingprep.com";
/// El plan gratuito permite unas 250 llamadas al día; no hace falta ir rápido.
static FMP_THROTTLE: Throttle = Throttle::new(Duration::from_millis(250));

/// Símbolos admitidos: letras, números, punto y guion (BRK.B, RDS-A…).
pub fn validate_symbol(symbol: &str) -> Result<&str, NetError> {
    let s = symbol.trim();
    if s.is_empty() || s.len() > 15 || !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return Err(NetError::Invalid(format!("Símbolo no válido: {symbol}")));
    }
    Ok(s)
}

#[tauri::command]
pub async fn price_quote(provider: String, symbol: String) -> Result<String, NetError> {
    let symbol = validate_symbol(&symbol)?.to_uppercase();
    match provider.as_str() {
        "fmp" => {
            let key = secrets::get("prices_api_key")?.ok_or_else(|| {
                NetError::Invalid("Falta la clave del proveedor de precios. Añádela en Ajustes.".into())
            })?;
            FMP_THROTTLE.wait().await;
            let req = client()
                .get("https://financialmodelingprep.com/stable/quote")
                .query(&[("symbol", symbol.as_str()), ("apikey", key.as_str())]);
            get_text(FMP_HOST, req).await
        }
        other => Err(NetError::Invalid(format!("Proveedor de precios no disponible todavía: {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valida_simbolos() {
        assert!(validate_symbol("AAPL").is_ok());
        assert!(validate_symbol("BRK.B").is_ok());
        assert!(validate_symbol("").is_err());
        assert!(validate_symbol("AAPL&apikey=x").is_err());
    }
}
