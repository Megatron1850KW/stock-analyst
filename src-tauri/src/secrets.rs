//! Claves de API en el Llavero de macOS (CLAUDE.md §2.7).
//!
//! El frontend puede guardar, comprobar y borrar una clave, pero no leerla:
//! las llamadas que la necesiten se harán desde Rust.

use keyring::Entry;

/// Servicio bajo el que se agrupan las entradas en Acceso a Llaveros.
pub const SERVICE: &str = "es.agentefinanciero.app";

/// Lista cerrada de claves admitidas. Debe coincidir con SECRET_KEYS en
/// src/features/settings/schema.ts.
pub const ALLOWED: &[&str] = &["anthropic_api_key", "prices_api_key", "openfigi_api_key"];

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("Clave no reconocida: {0}")]
    UnknownName(String),
    #[error("La clave está vacía")]
    Empty,
    #[error("No se pudo acceder al Llavero: {0}")]
    Keychain(#[from] keyring::Error),
}

impl serde::Serialize for SecretError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

fn entry(name: &str) -> Result<Entry, SecretError> {
    if !ALLOWED.contains(&name) {
        return Err(SecretError::UnknownName(name.to_owned()));
    }
    Ok(Entry::new(SERVICE, name)?)
}

pub fn set(name: &str, value: &str) -> Result<(), SecretError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(SecretError::Empty);
    }
    entry(name)?.set_password(value)?;
    Ok(())
}

pub fn exists(name: &str) -> Result<bool, SecretError> {
    match entry(name)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.into()),
    }
}

pub fn delete(name: &str) -> Result<(), SecretError> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Uso interno de Rust (fases siguientes): nunca se expone como comando.
#[allow(dead_code)]
pub fn get(name: &str) -> Result<Option<String>, SecretError> {
    match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), SecretError> {
    set(&name, &value)
}

#[tauri::command]
pub fn secret_exists(name: String) -> Result<bool, SecretError> {
    exists(&name)
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), SecretError> {
    delete(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn use_mock() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
    }

    #[test]
    fn rechaza_nombres_no_permitidos() {
        use_mock();
        assert!(matches!(set("otra_cosa", "x"), Err(SecretError::UnknownName(_))));
        assert!(matches!(exists("../etc"), Err(SecretError::UnknownName(_))));
    }

    #[test]
    fn rechaza_claves_vacias() {
        use_mock();
        assert!(matches!(set("anthropic_api_key", "   "), Err(SecretError::Empty)));
    }

    #[test]
    fn borrar_una_clave_inexistente_no_falla() {
        use_mock();
        assert!(delete("openfigi_api_key").is_ok());
        assert!(!exists("openfigi_api_key").unwrap());
    }

    #[test]
    fn el_error_no_incluye_el_valor_de_la_clave() {
        let msg = SecretError::Empty.to_string();
        assert!(!msg.contains("sk-"));
    }
}
