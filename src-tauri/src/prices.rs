//! Cotizaciones (CLAUDE.md §4.3): se piden una vez al abrir la app o con
//! «Actualizar precios». Proveedores: Tiingo (plan gratuito, elegido por el
//! usuario, EE. UU.), Financial Modeling Prep y Alpha Vantage (plan gratuito,
//! bolsas europeas). Las claves se leen del Llavero y nunca salen de Rust; con
//! Tiingo viaja en una cabecera, no en la URL.

use crate::http::{client, get_text, NetError, Throttle};
use crate::secrets;
use std::time::Duration;

const FMP_HOST: &str = "financialmodelingprep.com";
const TIINGO_HOST: &str = "api.tiingo.com";
const AV_HOST: &str = "www.alphavantage.co";
/// Plan gratuito de Alpha Vantage: 25 consultas al día y como mucho una por segundo.
static AV_THROTTLE: Throttle = Throttle::new(Duration::from_millis(1200));
/// Plan gratuito: 50 peticiones por hora; al ritmo de uso de la app sobra.
static TIINGO_THROTTLE: Throttle = Throttle::new(Duration::from_millis(250));
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

fn price_key() -> Result<String, NetError> {
    secrets::get("prices_api_key")?
        .ok_or_else(|| NetError::Invalid("Falta la clave del proveedor de precios. Añádela en Ajustes.".into()))
}

async fn fmp_get(path: &str, query: &[(&str, &str)]) -> Result<String, NetError> {
    let key = price_key()?;
    FMP_THROTTLE.wait().await;
    let req = client()
        .get(format!("https://financialmodelingprep.com/stable/{path}"))
        .query(query)
        .query(&[("apikey", key.as_str())]);
    get_text(FMP_HOST, req).await
}

/// Precios diarios de Tiingo: sin `start_date` devuelve el último día.
async fn tiingo_prices(symbol: &str, start_date: Option<&str>) -> Result<String, NetError> {
    let key = price_key()?;
    TIINGO_THROTTLE.wait().await;
    let mut req = client()
        .get(format!("https://api.tiingo.com/tiingo/daily/{}/prices", symbol.to_lowercase()))
        .header("Authorization", format!("Token {key}"));
    if let Some(d) = start_date {
        req = req.query(&[("startDate", d)]);
    }
    get_text(TIINGO_HOST, req).await
}

fn av_key() -> Result<String, NetError> {
    secrets::get("alphavantage_api_key")?
        .ok_or_else(|| NetError::Invalid("Falta la clave de Alpha Vantage (precios europeos). Añádela en Ajustes.".into()))
}

/// Consulta a Alpha Vantage. Sus errores llegan con estado 200 y un JSON
/// {"Information"|"Note"|"Error Message": …}; el frontend los traduce.
async fn av_get(function: &str, params: &[(&str, &str)]) -> Result<String, NetError> {
    let key = av_key()?;
    AV_THROTTLE.wait().await;
    let req = client()
        .get("https://www.alphavantage.co/query")
        .query(&[("function", function)])
        .query(params)
        .query(&[("apikey", key.as_str())]);
    get_text(AV_HOST, req).await
}

/// Texto de búsqueda de símbolos: letras (con acentos), números, espacios y . - &
pub fn validate_keywords(keywords: &str) -> Result<&str, NetError> {
    let k = keywords.trim();
    let ok = !k.is_empty()
        && k.chars().count() <= 60
        && k.chars().all(|c| c.is_alphanumeric() || c == ' ' || c == '.' || c == '-' || c == '&');
    if ok { Ok(k) } else { Err(NetError::Invalid(format!("Búsqueda no válida: {keywords}"))) }
}

fn unsupported(provider: &str) -> NetError {
    NetError::Invalid(format!("Proveedor de precios no disponible todavía: {provider}"))
}

/// Fecha AAAA-MM-DD (lo único que se acepta como «desde»).
pub fn validate_date(date: &str) -> Result<&str, NetError> {
    let b = date.as_bytes();
    let ok = b.len() == 10
        && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() });
    if ok { Ok(date) } else { Err(NetError::Invalid(format!("Fecha no válida: {date}"))) }
}

#[tauri::command]
pub async fn price_quote(provider: String, symbol: String) -> Result<String, NetError> {
    let symbol = validate_symbol(&symbol)?.to_uppercase();
    match provider.as_str() {
        "fmp" => fmp_get("quote", &[("symbol", symbol.as_str())]).await,
        "tiingo" => tiingo_prices(&symbol, None).await,
        "alphavantage" => av_get("GLOBAL_QUOTE", &[("symbol", symbol.as_str())]).await,
        other => Err(unsupported(other)),
    }
}

/// Cierres diarios ajustados por splits desde `from` (para valorar frente a la
/// propia historia y para el riesgo técnico de largo plazo). Se pide al añadir
/// un valor y, después, como mucho una vez al mes.
#[tauri::command]
pub async fn price_history(provider: String, symbol: String, from: String) -> Result<String, NetError> {
    let symbol = validate_symbol(&symbol)?.to_uppercase();
    let from = validate_date(&from)?;
    match provider.as_str() {
        "fmp" => fmp_get("historical-price-eod/full", &[("symbol", symbol.as_str()), ("from", from)]).await,
        // Trae también el factor de split de cada día
        "tiingo" => tiingo_prices(&symbol, Some(from)).await,
        other => Err(unsupported(other)),
    }
}

/// Velas semanales o mensuales completas (Alpha Vantage: el diario completo es
/// de pago). Traen el cierre sin ajustar y el ajustado, para deducir los splits.
#[tauri::command]
pub async fn price_series(provider: String, symbol: String, interval: String) -> Result<String, NetError> {
    let symbol = validate_symbol(&symbol)?.to_uppercase();
    let function = match interval.as_str() {
        "weekly" => "TIME_SERIES_WEEKLY_ADJUSTED",
        "monthly" => "TIME_SERIES_MONTHLY_ADJUSTED",
        other => return Err(NetError::Invalid(format!("Intervalo no válido: {other}"))),
    };
    match provider.as_str() {
        "alphavantage" => av_get(function, &[("symbol", symbol.as_str())]).await,
        other => Err(unsupported(other)),
    }
}

/// Búsqueda del símbolo de un valor en el proveedor (una vez por valor; se guarda).
#[tauri::command]
pub async fn price_search(provider: String, keywords: String) -> Result<String, NetError> {
    let keywords = validate_keywords(&keywords)?;
    match provider.as_str() {
        "alphavantage" => av_get("SYMBOL_SEARCH", &[("keywords", keywords)]).await,
        other => Err(unsupported(other)),
    }
}

/// Historial de splits (FMP). Con Tiingo los splits vienen en el histórico.
#[tauri::command]
pub async fn price_splits(provider: String, symbol: String) -> Result<String, NetError> {
    let symbol = validate_symbol(&symbol)?.to_uppercase();
    match provider.as_str() {
        "fmp" => fmp_get("splits", &[("symbol", symbol.as_str())]).await,
        other => Err(unsupported(other)),
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
        assert!(validate_symbol("ITX.MC").is_ok());
    }

    #[test]
    fn valida_busquedas() {
        assert!(validate_keywords("Industria de Diseño Textil").is_ok());
        assert!(validate_keywords("H&M").is_ok());
        assert!(validate_keywords("ITX&apikey=x").is_err());
        assert!(validate_keywords("a=b").is_err());
        assert!(validate_keywords("").is_err());
    }

    #[test]
    fn valida_fechas() {
        assert!(validate_date("2016-01-01").is_ok());
        assert!(validate_date("2016-1-01").is_err());
        assert!(validate_date("2016-01-01&x=1").is_err());
    }
}
