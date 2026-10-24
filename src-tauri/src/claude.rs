//! Puente hacia la API de Claude (CLAUDE.md §7).
//!
//! El frontend usa el SDK oficial `@anthropic-ai/sdk` con un `fetch` que pasa
//! por aquí: este comando añade la clave del Llavero, de modo que la clave
//! nunca llega al JavaScript ni a los logs. Solo se reenvían las rutas y
//! cabeceras de la lista cerrada.

use crate::http::{client, NetError};
use std::collections::HashMap;
use std::time::Duration;

const HOST: &str = "api.anthropic.com";
const BASE: &str = "https://api.anthropic.com";
/// Rutas permitidas: crear mensajes y contar tokens.
const PATHS: &[&str] = &["/v1/messages", "/v1/messages/count_tokens"];
/// Cabeceras que el SDK puede mandar; el resto (incluida cualquier x-api-key) se descarta.
const FORWARD: &[&str] = &["anthropic-version", "anthropic-beta", "content-type", "accept"];
/// Cabeceras de la respuesta que necesita el SDK (reintentos, id de petición).
const RETURN: &[&str] = &["content-type", "request-id", "retry-after", "retry-after-ms", "x-should-retry"];
/// Un análisis sin streaming puede tardar varios minutos.
const TIMEOUT: Duration = Duration::from_secs(600);
/// Cuerpo máximo que se envía (los PDF van en base64).
const MAX_BODY: usize = 40 * 1024 * 1024;

#[derive(serde::Serialize, Debug)]
pub struct ClaudeResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

pub fn validate_path(path: &str) -> Result<&str, NetError> {
    if PATHS.contains(&path) {
        Ok(path)
    } else {
        Err(NetError::Invalid(format!("Ruta de la API de Claude no permitida: {path}")))
    }
}

/// Cabeceras que se reenvían, en minúsculas y sin caracteres de control.
pub fn forwarded_headers(headers: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = headers
        .iter()
        .map(|(k, v)| (k.to_ascii_lowercase(), v.clone()))
        .filter(|(k, v)| FORWARD.contains(&k.as_str()) && !v.chars().any(|c| c.is_control()))
        .collect();
    out.sort();
    out
}

fn api_key() -> Result<String, NetError> {
    match keyring::Entry::new(crate::secrets::SERVICE, "anthropic_api_key")
        .map_err(crate::secrets::SecretError::from)?
        .get_password()
    {
        Ok(k) => Ok(k),
        Err(keyring::Error::NoEntry) => {
            Err(NetError::Invalid("Falta la clave de Claude. Añádela en Ajustes.".into()))
        }
        Err(e) => Err(crate::secrets::SecretError::from(e).into()),
    }
}

/// POST a la API de Claude. Devuelve estado, cabeceras y cuerpo tal cual: el SDK
/// interpreta los errores (429, 5xx…) y reintenta si procede.
#[tauri::command]
pub async fn claude_request(
    path: String,
    headers: HashMap<String, String>,
    body: String,
) -> Result<ClaudeResponse, NetError> {
    let path = validate_path(&path)?;
    if body.len() > MAX_BODY {
        return Err(NetError::Invalid("La petición a Claude es demasiado grande.".into()));
    }
    let key = api_key()?;
    let mut req = client()
        .post(format!("{BASE}{path}"))
        .timeout(TIMEOUT)
        .header("x-api-key", key)
        .body(body);
    for (k, v) in forwarded_headers(&headers) {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|_| NetError::Connect { host: HOST })?;
    let status = resp.status().as_u16();
    let headers = resp
        .headers()
        .iter()
        .filter(|(k, _)| RETURN.contains(&k.as_str()))
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_owned(), v.to_owned())))
        .collect();
    let body = resp.text().await.map_err(|_| NetError::Body { host: HOST })?;
    Ok(ClaudeResponse { status, headers, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_admite_rutas_de_mensajes() {
        assert!(validate_path("/v1/messages").is_ok());
        assert!(validate_path("/v1/messages/count_tokens").is_ok());
        assert!(validate_path("/v1/files").is_err());
        assert!(validate_path("/v1/messages/../organizations").is_err());
        assert!(validate_path("https://otro.example/v1/messages").is_err());
    }

    #[test]
    fn descarta_la_clave_y_cabeceras_desconocidas() {
        let mut h = HashMap::new();
        h.insert("X-Api-Key".to_owned(), "llavero".to_owned());
        h.insert("Authorization".to_owned(), "Bearer x".to_owned());
        h.insert("Anthropic-Version".to_owned(), "2023-06-01".to_owned());
        h.insert("anthropic-beta".to_owned(), "a\r\nx-api-key: b".to_owned());
        h.insert("content-type".to_owned(), "application/json".to_owned());
        assert_eq!(
            forwarded_headers(&h),
            vec![
                ("anthropic-version".to_owned(), "2023-06-01".to_owned()),
                ("content-type".to_owned(), "application/json".to_owned()),
            ]
        );
    }
}
