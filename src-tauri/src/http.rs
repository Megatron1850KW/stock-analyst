//! Cliente HTTP compartido y limitador de ritmo.

use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum NetError {
    #[error("{0}")]
    Invalid(String),
    #[error("No se pudo conectar con {host}. Comprueba tu conexión a internet.")]
    Connect { host: &'static str },
    #[error("{host} respondió con el error {status}")]
    Status { host: &'static str, status: u16 },
    #[error("{host} ha limitado las consultas. Inténtalo de nuevo en unos minutos.")]
    RateLimited { host: &'static str },
    #[error("Respuesta no válida de {host}")]
    Body { host: &'static str },
    #[error("{0}")]
    Secret(#[from] crate::secrets::SecretError),
}

impl serde::Serialize for NetError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .gzip(true)
            .build()
            .expect("cliente HTTP")
    })
}

/// Garantiza un intervalo mínimo entre peticiones a un mismo servicio.
pub struct Throttle {
    min_interval: Duration,
    last: Mutex<Option<Instant>>,
}

impl Throttle {
    pub const fn new(min_interval: Duration) -> Self {
        Self { min_interval, last: Mutex::const_new(None) }
    }

    pub async fn wait(&self) {
        let mut last = self.last.lock().await;
        if let Some(prev) = *last {
            let elapsed = prev.elapsed();
            if elapsed < self.min_interval {
                tokio::time::sleep(self.min_interval - elapsed).await;
            }
        }
        *last = Some(Instant::now());
    }
}

/// GET que devuelve el cuerpo como texto; el frontend lo valida con Zod.
pub async fn get_text(
    host: &'static str,
    req: reqwest::RequestBuilder,
) -> Result<String, NetError> {
    let resp = req.send().await.map_err(|_| NetError::Connect { host })?;
    let status = resp.status();
    if status.as_u16() == 429 {
        return Err(NetError::RateLimited { host });
    }
    if !status.is_success() {
        return Err(NetError::Status { host, status: status.as_u16() });
    }
    resp.text().await.map_err(|_| NetError::Body { host })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn el_limitador_respeta_el_intervalo() {
        let t = Throttle::new(Duration::from_millis(110));
        let start = tokio::time::Instant::now();
        for _ in 0..5 {
            t.wait().await;
        }
        // 5 peticiones → al menos 4 intervalos
        assert!(start.elapsed() >= Duration::from_millis(440));
    }
}
