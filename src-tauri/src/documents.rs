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
