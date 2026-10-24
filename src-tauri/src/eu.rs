//! Europa (CLAUDE.md §4.2). Fuentes gratuitas y oficiales:
//!
//! - GLEIF: ISIN → LEI (identificador oficial de la entidad que presenta los informes).
//! - OpenFIGI: ISIN → tickers y bolsas donde cotiza.
//! - filings.xbrl.org: informes anuales ESEF y su versión xBRL-JSON.
//!
//! Igual que con la SEC, solo se consultan recursos fijos con argumentos
//! validados; el frontend no puede pedir URLs libres.

use crate::http::{client, get_text, NetError, Throttle};
use std::time::Duration;

const GLEIF_HOST: &str = "api.gleif.org";
const FIGI_HOST: &str = "api.openfigi.com";
const XBRL_HOST: &str = "filings.xbrl.org";
static GLEIF_THROTTLE: Throttle = Throttle::new(Duration::from_millis(250));
/// OpenFIGI sin clave: 25 peticiones por minuto.
static FIGI_THROTTLE: Throttle = Throttle::new(Duration::from_millis(2500));
static XBRL_THROTTLE: Throttle = Throttle::new(Duration::from_millis(500));

/// ISIN: 2 letras de país, 9 alfanuméricos y un dígito de control (Luhn sobre letras convertidas).
pub fn validate_isin(isin: &str) -> Result<String, NetError> {
    let s = isin.trim().to_uppercase();
    let b = s.as_bytes();
    let shape = b.len() == 12
        && b[..2].iter().all(u8::is_ascii_uppercase)
        && b[2..11].iter().all(u8::is_ascii_alphanumeric)
        && b[11].is_ascii_digit();
    if !shape || !isin_checksum_ok(&s) {
        return Err(NetError::Invalid(format!("ISIN no válido: {isin}")));
    }
    Ok(s)
}

fn isin_checksum_ok(s: &str) -> bool {
    let digits: String = s.chars().map(|c| if c.is_ascii_digit() { c.to_string() } else { (c as u32 - 'A' as u32 + 10).to_string() }).collect();
    let sum: u32 = digits
        .chars()
        .rev()
        .enumerate()
        .map(|(i, c)| {
            let d = c.to_digit(10).unwrap_or(0);
            if i % 2 == 1 { let x = d * 2; x / 10 + x % 10 } else { d }
        })
        .sum();
    sum % 10 == 0
}

/// LEI: 20 caracteres alfanuméricos en mayúsculas.
pub fn validate_lei(lei: &str) -> Result<&str, NetError> {
    let ok = lei.len() == 20 && lei.bytes().all(|c| c.is_ascii_digit() || c.is_ascii_uppercase());
    if ok { Ok(lei) } else { Err(NetError::Invalid(format!("LEI no válido: {lei}"))) }
}

/// Ruta de un xBRL-JSON tal como la da filings.xbrl.org (json_url):
/// /<LEI>/<AAAA-MM-DD>/ESEF/<país>/<n>/<fichero>.json
pub fn validate_xbrl_json_path(path: &str) -> Result<&str, NetError> {
    let bad = || NetError::Invalid(format!("Informe ESEF no válido: {path}"));
    let parts: Vec<&str> = path.strip_prefix('/').ok_or_else(bad)?.split('/').collect();
    let [lei, date, esef, country, n, file] = parts.as_slice() else { return Err(bad()) };
    let date_ok = date.len() == 10 && date.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() });
    let file_ok = file.len() <= 120
        && !file.starts_with('.')
        && file.ends_with(".json")
        && file.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    let ok = validate_lei(lei).is_ok()
        && date_ok
        && *esef == "ESEF"
        && country.len() == 2
        && country.bytes().all(|c| c.is_ascii_uppercase())
        && !n.is_empty()
        && n.len() <= 3
        && n.bytes().all(|c| c.is_ascii_digit())
        && file_ok;
    if ok { Ok(path) } else { Err(bad()) }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EuResource {
    /// GLEIF: registro LEI a partir del ISIN.
    LeiByIsin,
    /// OpenFIGI: tickers y bolsas de un ISIN.
    Figi,
    /// filings.xbrl.org: lista de informes ESEF de una entidad (LEI).
    EsefFilings,
}

#[tauri::command]
pub async fn eu_fetch(resource: EuResource, id: String) -> Result<String, NetError> {
    match resource {
        EuResource::LeiByIsin => {
            let isin = validate_isin(&id)?;
            GLEIF_THROTTLE.wait().await;
            let req = client()
                .get("https://api.gleif.org/api/v1/lei-records")
                .query(&[("filter[isin]", isin.as_str())])
                .header(reqwest::header::ACCEPT, "application/vnd.api+json");
            get_text(GLEIF_HOST, req).await
        }
        EuResource::Figi => {
            let isin = validate_isin(&id)?;
            FIGI_THROTTLE.wait().await;
            let body = serde_json::json!([{ "idType": "ID_ISIN", "idValue": isin }]);
            let req = client().post("https://api.openfigi.com/v3/mapping").json(&body);
            get_text(FIGI_HOST, req).await
        }
        EuResource::EsefFilings => {
            let lei = validate_lei(&id)?;
            XBRL_THROTTLE.wait().await;
            let req = client()
                .get(format!("https://filings.xbrl.org/api/entities/{lei}/filings"))
                .query(&[("page[size]", "100")])
                .header(reqwest::header::ACCEPT, "application/vnd.api+json");
            get_text(XBRL_HOST, req).await
        }
    }
}

/// Ruta local de un xBRL-JSON: documents/esef/<LEI>/<fecha>/<n>/<fichero>.
pub fn esef_path(root: &std::path::Path, path: &str) -> Result<std::path::PathBuf, NetError> {
    let path = validate_xbrl_json_path(path)?;
    let parts: Vec<&str> = path[1..].split('/').collect();
    let mut p = root.join("esef");
    for (i, part) in parts.iter().enumerate() {
        if i != 2 && i != 3 {
            p.push(part);
        }
    }
    Ok(p)
}

#[derive(serde::Serialize, Debug)]
pub struct EsefDocument {
    /// Contenido: xBRL-JSON o XHTML del informe.
    text: String,
    path: String,
    cached: bool,
}

/// Cifras de un informe ESEF en xBRL-JSON. Se descarga una sola vez y se guarda en el Mac.
#[tauri::command]
pub async fn esef_document(app: tauri::AppHandle, path: String) -> Result<EsefDocument, NetError> {
    let root = crate::documents::documents_dir(&app).map_err(|e| NetError::Invalid(e.to_string()))?;
    let local = esef_path(&root, &path)?;
    let shown = local.to_string_lossy().into_owned();
    if let Ok(json) = std::fs::read_to_string(&local) {
        return Ok(EsefDocument { text: json, path: shown, cached: true });
    }
    XBRL_THROTTLE.wait().await;
    let req = client().get(format!("https://filings.xbrl.org{path}")).header(reqwest::header::ACCEPT, "application/json");
    let json = get_text(XBRL_HOST, req).await?;
    if let Some(dir) = local.parent() {
        let tmp = local.with_extension("part");
        let saved = std::fs::create_dir_all(dir).and_then(|_| std::fs::write(&tmp, &json)).and_then(|_| std::fs::rename(&tmp, &local));
        if saved.is_err() {
            return Ok(EsefDocument { text: json, path: String::new(), cached: false });
        }
    }
    Ok(EsefDocument { text: json, path: shown, cached: false })
}

/// URL de un informe ESEF (Inline XBRL) tal como la da filings.xbrl.org (report_url):
/// https://filings.xbrl.org/<LEI>/<fecha>/ESEF/<país>/<n>/<carpeta>/reports/<fichero>.xhtml
pub fn validate_report_url(url: &str) -> Result<&str, NetError> {
    let bad = || NetError::Invalid(format!("Informe ESEF no válido: {url}"));
    let rest = url.strip_prefix("https://filings.xbrl.org/").ok_or_else(bad)?;
    let parts: Vec<&str> = rest.split('/').collect();
    let [lei, date, esef, country, n, folder, reports, file] = parts.as_slice() else { return Err(bad()) };
    let name_ok = |s: &str| !s.is_empty() && s.len() <= 120 && !s.starts_with('.') && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    let json_like = format!("/{lei}/{date}/{esef}/{country}/{n}/x.json");
    let ok = validate_xbrl_json_path(&json_like).is_ok()
        && name_ok(folder)
        && *reports == "reports"
        && name_ok(file)
        && (file.ends_with(".xhtml") || file.ends_with(".html"));
    if ok { Ok(url) } else { Err(bad()) }
}

/// Texto completo de un informe ESEF (para los extractos que lee la IA). Se
/// descarga una sola vez y se guarda junto a su xBRL-JSON.
#[tauri::command]
pub async fn esef_report(app: tauri::AppHandle, url: String) -> Result<EsefDocument, NetError> {
    let url = validate_report_url(&url)?.to_owned();
    let root = crate::documents::documents_dir(&app).map_err(|e| NetError::Invalid(e.to_string()))?;
    let parts: Vec<&str> = url["https://filings.xbrl.org/".len()..].split('/').collect();
    let local = root.join("esef").join(parts[0]).join(parts[1]).join(parts[4]).join(parts[7]);
    let shown = local.to_string_lossy().into_owned();
    if let Ok(json) = std::fs::read_to_string(&local) {
        return Ok(EsefDocument { text: json, path: shown, cached: true });
    }
    XBRL_THROTTLE.wait().await;
    let html = get_text(XBRL_HOST, client().get(&url).header(reqwest::header::ACCEPT, "application/xhtml+xml,text/html")).await?;
    if let Some(dir) = local.parent() {
        let tmp = local.with_extension("part");
        let saved = std::fs::create_dir_all(dir).and_then(|_| std::fs::write(&tmp, &html)).and_then(|_| std::fs::rename(&tmp, &local));
        if saved.is_err() {
            return Ok(EsefDocument { text: html, path: String::new(), cached: false });
        }
    }
    Ok(EsefDocument { text: html, path: shown, cached: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valida_isin_con_digito_de_control() {
        assert_eq!(validate_isin("es0148396007").unwrap(), "ES0148396007");
        assert!(validate_isin("US0378331005").is_ok()); // Apple
        assert!(validate_isin("DE0007164600").is_ok()); // SAP
        assert!(validate_isin("ES0148396008").is_err());
        assert!(validate_isin("ES014839600").is_err());
        assert!(validate_isin("ES014839600&x").is_err());
    }

    #[test]
    fn valida_lei() {
        assert!(validate_lei("549300TTCXZOGZM2EY83").is_ok());
        assert!(validate_lei("549300ttcxzogzm2ey83").is_err());
        assert!(validate_lei("549300TTCXZOGZM2EY8/").is_err());
    }

    #[test]
    fn solo_descarga_xbrl_json_de_filings_xbrl_org() {
        let ok = "/549300TTCXZOGZM2EY83/2026-01-31/ESEF/ES/0/549300TTCXZOGZM2EY83-2026-01-31-1-es.json";
        assert!(validate_xbrl_json_path(ok).is_ok());
        for bad in [
            "/549300TTCXZOGZM2EY83/2026-01-31/ESEF/ES/0/../x.json",
            "/549300TTCXZOGZM2EY83/2026-01-31/ESEF/ES/0/a.zip",
            "549300TTCXZOGZM2EY83/2026-01-31/ESEF/ES/0/a.json",
            "/549300TTCXZOGZM2EY83/2026-01-31/OTRO/ES/0/a.json",
            "//evil.example/2026-01-31/ESEF/ES/0/a.json",
        ] {
            assert!(validate_xbrl_json_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn solo_descarga_informes_esef_de_filings_xbrl_org() {
        let ok = "https://filings.xbrl.org/549300TTCXZOGZM2EY83/2026-01-31/ESEF/ES/0/549300TTCXZOGZM2EY83-2026-01-31/reports/549300TTCXZOGZM2EY83-2026-01-31.xhtml";
        assert!(validate_report_url(ok).is_ok());
        for bad in [
            "https://filings.xbrl.org/549300TTCXZOGZM2EY83/2026-01-31/ESEF/ES/0/x/reports/../a.xhtml",
            "https://filings.xbrl.org/549300TTCXZOGZM2EY83/2026-01-31/ESEF/ES/0/x/otro/a.xhtml",
            "https://evil.example/549300TTCXZOGZM2EY83/2026-01-31/ESEF/ES/0/x/reports/a.xhtml",
            "https://filings.xbrl.org/549300TTCXZOGZM2EY83/2026-01-31/ESEF/ES/0/x/reports/a.exe",
        ] {
            assert!(validate_report_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn guarda_cada_informe_por_lei_y_fecha() {
        let root = std::path::Path::new("/datos/documents");
        assert_eq!(
            esef_path(root, "/549300TTCXZOGZM2EY83/2026-01-31/ESEF/ES/0/x-es.json").unwrap(),
            std::path::Path::new("/datos/documents/esef/549300TTCXZOGZM2EY83/2026-01-31/0/x-es.json")
        );
    }
}
