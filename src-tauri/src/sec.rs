//! SEC EDGAR (CLAUDE.md §4.1). Gratuito y oficial.
//!
//! - La SEC exige un User-Agent con nombre y email y como máximo 10 peticiones
//!   por segundo: aquí se fuerzan ambos.
//! - Solo se consultan tres recursos fijos; el frontend no puede pedir URLs libres.

use crate::http::{client, get_text, NetError, Throttle};
use std::time::Duration;

const HOST: &str = "sec.gov";
/// 110 ms entre peticiones → menos de 10 por segundo.
static THROTTLE: Throttle = Throttle::new(Duration::from_millis(110));

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecResource {
    /// Mapeo ticker → CIK con bolsa (company_tickers_exchange.json).
    Tickers,
    /// Lista de presentaciones (10-K, 10-Q, 20-F…).
    Submissions,
    /// Datos XBRL estructurados de todas las presentaciones.
    CompanyFacts,
    /// Página adicional de presentaciones antiguas (CIK##########-submissions-001.json).
    SubmissionsFile,
}

/// Nombre de página adicional tal como lo da submissions.filings.files[].name.
pub fn validate_submissions_file(name: &str) -> Result<&str, NetError> {
    let ok = name.len() == 34
        && name.starts_with("CIK")
        && name[3..13].chars().all(|c| c.is_ascii_digit())
        && &name[13..26] == "-submissions-"
        && name[26..29].chars().all(|c| c.is_ascii_digit())
        && name.ends_with(".json");
    if ok { Ok(name) } else { Err(NetError::Invalid(format!("Fichero de la SEC no válido: {name}"))) }
}

/// Normaliza un CIK a 10 dígitos con ceros a la izquierda.
pub fn normalize_cik(cik: &str) -> Result<String, NetError> {
    let digits = cik.trim().trim_start_matches("CIK");
    if digits.is_empty() || digits.len() > 10 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return Err(NetError::Invalid(format!("CIK no válido: {cik}")));
    }
    Ok(format!("{digits:0>10}"))
}

/// User-Agent "Nombre email" exigido por la SEC.
pub fn validate_user_agent(ua: &str) -> Result<&str, NetError> {
    let ua = ua.trim();
    let has_email = ua.split_whitespace().any(|w| {
        let mut parts = w.split('@');
        matches!((parts.next(), parts.next(), parts.next()), (Some(a), Some(b), None) if !a.is_empty() && b.contains('.'))
    });
    if ua.len() < 5 || ua.len() > 200 || !has_email || ua.chars().any(|c| c.is_control()) {
        return Err(NetError::Invalid(
            "Falta tu nombre y email para la SEC. Añádelos en Ajustes.".into(),
        ));
    }
    Ok(ua)
}

pub fn url_for(resource: SecResource, cik: Option<&str>) -> Result<String, NetError> {
    Ok(match resource {
        SecResource::Tickers => "https://www.sec.gov/files/company_tickers_exchange.json".into(),
        SecResource::SubmissionsFile => {
            let file = validate_submissions_file(cik.ok_or_else(|| NetError::Invalid("Falta el fichero".into()))?)?;
            format!("https://data.sec.gov/submissions/{file}")
        }
        SecResource::Submissions | SecResource::CompanyFacts => {
            let cik = normalize_cik(cik.ok_or_else(|| NetError::Invalid("Falta el CIK".into()))?)?;
            if resource == SecResource::Submissions {
                format!("https://data.sec.gov/submissions/CIK{cik}.json")
            } else {
                format!("https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
            }
        }
    })
}

#[tauri::command]
pub async fn sec_fetch(
    resource: SecResource,
    cik: Option<String>,
    file: Option<String>,
    user_agent: String,
) -> Result<String, NetError> {
    let ua = validate_user_agent(&user_agent)?.to_owned();
    let arg = if resource == SecResource::SubmissionsFile { file } else { cik };
    let url = url_for(resource, arg.as_deref())?;
    THROTTLE.wait().await;
    let req = client()
        .get(url)
        .header(reqwest::header::USER_AGENT, ua)
        .header(reqwest::header::ACCEPT, "application/json");
    get_text(HOST, req).await
}

/// URL de un documento del archivo de EDGAR, tal como se guarda en filings.url:
/// https://www.sec.gov/Archives/edgar/data/<cik>/<accession sin guiones>/<fichero>.htm
pub fn validate_archive_url(url: &str) -> Result<&str, NetError> {
    let bad = || NetError::Invalid(format!("Documento de la SEC no válido: {url}"));
    let rest = url.strip_prefix("https://www.sec.gov/Archives/edgar/data/").ok_or_else(bad)?;
    let parts: Vec<&str> = rest.split('/').collect();
    let [cik, acc, file] = parts.as_slice() else { return Err(bad()) };
    let digits = |s: &str, min: usize, max: usize| (min..=max).contains(&s.len()) && s.chars().all(|c| c.is_ascii_digit());
    let name_ok = file.len() <= 120
        && !file.starts_with('.')
        && file.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && (file.ends_with(".htm") || file.ends_with(".html"));
    if digits(cik, 1, 10) && digits(acc, 18, 18) && name_ok { Ok(url) } else { Err(bad()) }
}

/// Ruta local de un documento de EDGAR: documents/sec/<cik>/<accession>/<fichero>.
/// Se guarda por CIK para que lo compartan la watchlist y los competidores.
pub fn archive_path(root: &std::path::Path, url: &str) -> Result<std::path::PathBuf, NetError> {
    let url = validate_archive_url(url)?;
    let rest = &url["https://www.sec.gov/Archives/edgar/data/".len()..];
    let mut p = root.join("sec");
    for part in rest.split('/') {
        p.push(part);
    }
    Ok(p)
}

#[derive(serde::Serialize, Debug)]
pub struct SecDocument {
    html: String,
    path: String,
    /// true si ya estaba guardado en el Mac y no se ha pedido a la SEC.
    cached: bool,
}

/// Un 10-K/10-Q/20-F en HTML para extraer sus secciones de texto. Se descarga
/// una sola vez y se guarda en la carpeta de datos de la app (CLAUDE.md §7).
#[tauri::command]
pub async fn sec_document(app: tauri::AppHandle, url: String, user_agent: String) -> Result<SecDocument, NetError> {
    let root = crate::documents::documents_dir(&app).map_err(|e| NetError::Invalid(e.to_string()))?;
    let path = archive_path(&root, &url)?;
    let shown = path.to_string_lossy().into_owned();
    if let Ok(html) = std::fs::read_to_string(&path) {
        return Ok(SecDocument { html, path: shown, cached: true });
    }
    let ua = validate_user_agent(&user_agent)?.to_owned();
    THROTTLE.wait().await;
    let req = client()
        .get(url)
        .header(reqwest::header::USER_AGENT, ua)
        .header(reqwest::header::ACCEPT, "text/html");
    let html = get_text(HOST, req).await?;
    // Si no se puede guardar, el análisis sigue con lo descargado
    if let Some(dir) = path.parent() {
        let tmp = path.with_extension("part");
        let saved = std::fs::create_dir_all(dir).and_then(|_| std::fs::write(&tmp, &html)).and_then(|_| std::fs::rename(&tmp, &path));
        if saved.is_err() {
            return Ok(SecDocument { html, path: String::new(), cached: false });
        }
    }
    Ok(SecDocument { html, path: shown, cached: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guarda_cada_documento_por_cik_y_registro() {
        let root = std::path::Path::new("/datos/documents");
        assert_eq!(
            archive_path(root, "https://www.sec.gov/Archives/edgar/data/723125/000072312525000028/mu-20250828.htm").unwrap(),
            std::path::Path::new("/datos/documents/sec/723125/000072312525000028/mu-20250828.htm")
        );
        assert!(archive_path(root, "https://www.sec.gov/Archives/edgar/data/1/000072312525000028/../x.htm").is_err());
    }

    #[test]
    fn solo_descarga_documentos_del_archivo_de_edgar() {
        let ok = "https://www.sec.gov/Archives/edgar/data/723125/000072312525000028/mu-20250828.htm";
        assert!(validate_archive_url(ok).is_ok());
        for bad in [
            "https://www.sec.gov/Archives/edgar/data/723125/000072312525000028/../../x.htm",
            "https://www.sec.gov/Archives/edgar/data/723125/0000723125-25-000028/mu.htm",
            "https://www.sec.gov/Archives/edgar/data/723125/000072312525000028/mu.pdf",
            "https://evil.example/Archives/edgar/data/1/000072312525000028/a.htm",
            "https://www.sec.gov/Archives/edgar/data/723125/000072312525000028/.htm",
        ] {
            assert!(validate_archive_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn normaliza_el_cik_a_10_digitos() {
        assert_eq!(normalize_cik("320193").unwrap(), "0000320193");
        assert_eq!(normalize_cik("CIK0000320193").unwrap(), "0000320193");
        assert!(normalize_cik("12a").is_err());
        assert!(normalize_cik("../../etc").is_err());
        assert!(normalize_cik("12345678901").is_err());
    }

    #[test]
    fn construye_solo_urls_de_la_sec() {
        assert_eq!(
            url_for(SecResource::CompanyFacts, Some("320193")).unwrap(),
            "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json"
        );
        assert_eq!(
            url_for(SecResource::Submissions, Some("1")).unwrap(),
            "https://data.sec.gov/submissions/CIK0000000001.json"
        );
        assert!(url_for(SecResource::Submissions, None).is_err());
        assert_eq!(
            url_for(SecResource::SubmissionsFile, Some("CIK0000320193-submissions-001.json")).unwrap(),
            "https://data.sec.gov/submissions/CIK0000320193-submissions-001.json"
        );
        assert!(url_for(SecResource::SubmissionsFile, Some("../files/x.json")).is_err());
    }

    #[test]
    fn exige_nombre_y_email_en_el_user_agent() {
        assert!(validate_user_agent("Pablo pablo@example.com").is_ok());
        assert!(validate_user_agent("").is_err());
        assert!(validate_user_agent("Pablo").is_err());
        assert!(validate_user_agent("Pablo pablo@").is_err());
        assert!(validate_user_agent("Pablo a@b.es\r\nX: y").is_err());
    }
}
