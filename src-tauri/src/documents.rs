//! Informes subidos por el usuario (CLAUDE.md §4.4): PDF o ZIP (ESEF) que la
//! app no encuentra por sí sola. Se guardan en la carpeta de datos de la app,
//! en `documents/<id del valor>/`, con su huella SHA-256.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

/// Tamaño máximo de un informe (los ZIP ESEF grandes rondan los 100 MB).
const MAX_BYTES: usize = 250 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum DocError {
    #[error("{0}")]
    Invalid(String),
    #[error("No se pudo guardar el archivo en tu Mac: {0}")]
    Io(#[from] std::io::Error),
    #[error("No se encuentra la carpeta de datos de la app")]
    NoDataDir,
}

impl serde::Serialize for DocError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Debug, serde::Serialize, PartialEq)]
pub struct StoredDocument {
    pub path: String,
    pub sha256: String,
    pub bytes: usize,
    pub kind: &'static str,
}

/// Solo se aceptan PDF y ZIP, comprobando su firma y no solo la extensión.
pub fn detect_kind(data: &[u8]) -> Result<&'static str, DocError> {
    if data.starts_with(b"%PDF-") {
        Ok("pdf")
    } else if data.starts_with(b"PK\x03\x04") {
        Ok("zip")
    } else {
        Err(DocError::Invalid("El archivo no es un PDF ni un ZIP. Sube el informe en PDF o el paquete ESEF (.zip).".into()))
    }
}

/// Nombre seguro para el disco: sin rutas ni caracteres raros, con la extensión correcta.
pub fn safe_name(original: &str, kind: &str) -> String {
    let base = Path::new(original).file_stem().and_then(|s| s.to_str()).unwrap_or("informe");
    let mut clean: String = base
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .take(80)
        .collect();
    clean = clean.trim_matches('-').to_string();
    if clean.is_empty() {
        clean = "informe".into();
    }
    format!("{clean}.{kind}")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn documents_dir(app: &AppHandle) -> Result<PathBuf, DocError> {
    Ok(app.path().app_data_dir().map_err(|_| DocError::NoDataDir)?.join("documents"))
}

pub fn store(root: &Path, security_id: i64, original_name: &str, data: &[u8]) -> Result<StoredDocument, DocError> {
    if data.is_empty() {
        return Err(DocError::Invalid("El archivo está vacío".into()));
    }
    if data.len() > MAX_BYTES {
        return Err(DocError::Invalid("El archivo pasa de 250 MB".into()));
    }
    let kind = detect_kind(data)?;
    let sha = hex(&Sha256::digest(data));
    let dir = root.join(security_id.to_string());
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}-{}", &sha[..12], safe_name(original_name, kind)));
    if !path.exists() {
        // Escritura atómica: primero a un temporal y luego renombrar
        let tmp = path.with_extension("part");
        std::fs::write(&tmp, data)?;
        std::fs::rename(&tmp, &path)?;
    }
    Ok(StoredDocument { path: path.to_string_lossy().into_owned(), sha256: sha, bytes: data.len(), kind })
}

/// Recibe el archivo como cuerpo binario (sin pasar por JSON) y el nombre e id
/// del valor en cabeceras.
#[tauri::command]
pub fn document_store(app: AppHandle, request: Request<'_>) -> Result<StoredDocument, DocError> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err(DocError::Invalid("Se esperaba el archivo en binario".into()));
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let security_id: i64 = header("x-security-id")
        .and_then(|v| v.parse().ok())
        .filter(|id| *id > 0)
        .ok_or_else(|| DocError::Invalid("Falta el valor al que pertenece el informe".into()))?;
    let name = header("x-file-name").map(|n| percent_decode(&n)).unwrap_or_else(|| "informe".into());
    store(&documents_dir(&app)?, security_id, &name, data)
}

/// Solo rutas dentro de la carpeta de documentos de la app.
fn inside_documents(app: &AppHandle, path: &str) -> Result<PathBuf, DocError> {
    let root = documents_dir(app)?.canonicalize()?;
    let p = Path::new(path).canonicalize()?;
    if p.starts_with(&root) { Ok(p) } else { Err(DocError::Invalid("Ruta fuera de la carpeta de informes".into())) }
}

/// Abre el informe con la app predeterminada (Vista Previa para los PDF).
#[tauri::command]
pub fn document_open(app: AppHandle, path: String) -> Result<(), DocError> {
    let p = inside_documents(&app, &path)?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&p).spawn()?;
    #[cfg(not(target_os = "macos"))]
    let _ = p;
    Ok(())
}

/// Tamaño máximo de un PDF que se envía a Claude (la API admite 32 MB por petición).
const MAX_PDF_FOR_AI: u64 = 30 * 1024 * 1024;

/// Bytes de un PDF guardado, para enviarlo a Claude y extraer sus cifras (§4.4).
/// Viaja en binario hacia la vista web; allí se pasa a base64.
#[tauri::command]
pub fn document_read_pdf(app: AppHandle, path: String) -> Result<tauri::ipc::Response, DocError> {
    let p = inside_documents(&app, &path)?;
    if std::fs::metadata(&p)?.len() > MAX_PDF_FOR_AI {
        return Err(DocError::Invalid(
            "El PDF pasa de 30 MB y Claude no puede leerlo entero. Sube solo el informe semestral o las páginas de los estados financieros.".into(),
        ));
    }
    let data = std::fs::read(&p)?;
    if detect_kind(&data)? != "pdf" {
        return Err(DocError::Invalid("El archivo no es un PDF".into()));
    }
    Ok(tauri::ipc::Response::new(data))
}

/// Tope al descomprimir el informe de un ZIP ESEF (protege de ZIP malformados o «bombas»).
const MAX_REPORT_BYTES: u64 = 150 * 1024 * 1024;

/// Informe Inline XBRL (.xhtml/.html) de un paquete ESEF: el más grande dentro de
/// una carpeta `reports/` (las otras carpetas traen la taxonomía de la empresa).
pub fn esef_report_from_zip(data: &[u8]) -> Result<String, DocError> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(data))
        .map_err(|_| DocError::Invalid("El ZIP está dañado o no es un paquete ESEF.".into()))?;
    let mut best: Option<(usize, u64)> = None;
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(|_| DocError::Invalid("El ZIP está dañado.".into()))?;
        let name = f.name().to_ascii_lowercase();
        let is_report = name.split('/').any(|p| p == "reports") && (name.ends_with(".xhtml") || name.ends_with(".html"));
        if is_report && best.map_or(true, |(_, size)| f.size() > size) {
            best = Some((i, f.size()));
        }
    }
    let (index, size) = best.ok_or_else(|| DocError::Invalid("El ZIP no contiene un informe ESEF (carpeta reports con un .xhtml).".into()))?;
    if size > MAX_REPORT_BYTES {
        return Err(DocError::Invalid("El informe del ZIP es demasiado grande.".into()));
    }
    let f = zip.by_index(index).map_err(|_| DocError::Invalid("El ZIP está dañado.".into()))?;
    let mut out = String::new();
    use std::io::Read;
    f.take(MAX_REPORT_BYTES)
        .read_to_string(&mut out)
        .map_err(|_| DocError::Invalid("El informe del ZIP no es texto UTF-8 válido.".into()))?;
    Ok(out)
}

/// Contenido del informe de un ZIP ESEF que subiste, para leer sus cifras sin IA.
#[tauri::command]
pub fn document_esef_report(app: AppHandle, path: String) -> Result<String, DocError> {
    let p = inside_documents(&app, &path)?;
    let data = std::fs::read(&p)?;
    if detect_kind(&data)? != "zip" {
        return Err(DocError::Invalid("El archivo no es un ZIP".into()));
    }
    esef_report_from_zip(&data)
}

#[tauri::command]
pub fn document_delete(app: AppHandle, path: String) -> Result<(), DocError> {
    let p = inside_documents(&app, &path)?;
    std::fs::remove_file(p)?;
    Ok(())
}

/// Decodifica %XX (el nombre viaja así para admitir tildes en una cabecera).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut k = 0;
    while k < bytes.len() {
        if bytes[k] == b'%' && k + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[k + 1..k + 3], 16) {
                out.push(b);
                k += 3;
                continue;
            }
        }
        out.push(bytes[k]);
        k += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saca_el_informe_xhtml_de_un_zip_esef() {
        use std::io::Write;
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file("FICTICIO-2025/META-INF/taxonomyPackage.xml", opts).unwrap();
            w.write_all(b"<x/>").unwrap();
            w.start_file("FICTICIO-2025/reports/informe.xhtml", opts).unwrap();
            w.write_all(b"<html>informe ficticio</html>").unwrap();
            w.finish().unwrap();
        }
        assert_eq!(esef_report_from_zip(buf.get_ref()).unwrap(), "<html>informe ficticio</html>");
        assert!(esef_report_from_zip(b"PK\x03\x04 roto").is_err());
    }

    #[test]
    fn reconoce_pdf_y_zip_por_su_firma() {
        assert_eq!(detect_kind(b"%PDF-1.7 ...").unwrap(), "pdf");
        assert_eq!(detect_kind(b"PK\x03\x04...").unwrap(), "zip");
        assert!(detect_kind(b"<html>").is_err());
    }

    #[test]
    fn limpia_el_nombre() {
        assert_eq!(safe_name("../../Informe anual 2025.PDF", "pdf"), "Informe-anual-2025.pdf");
        assert_eq!(safe_name("Información_H1.pdf", "pdf"), "Información_H1.pdf");
        assert_eq!(safe_name("###.zip", "zip"), "informe.zip");
        assert_eq!(percent_decode("Informaci%C3%B3n%20H1.pdf"), "Información H1.pdf");
    }

    #[test]
    fn guarda_con_huella_y_sin_duplicar() {
        let root = std::env::temp_dir().join(format!("af-docs-{}", std::process::id()));
        let a = store(&root, 7, "a.pdf", b"%PDF-1.4 ficticio").unwrap();
        let b = store(&root, 7, "a.pdf", b"%PDF-1.4 ficticio").unwrap();
        assert_eq!(a, b);
        assert_eq!(a.sha256.len(), 64);
        assert!(a.path.contains("/7/"));
        assert_eq!(std::fs::read(&a.path).unwrap(), b"%PDF-1.4 ficticio");
        assert!(store(&root, 7, "x.pdf", b"").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
