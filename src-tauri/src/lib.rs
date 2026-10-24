mod secrets;

use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Debe coincidir con DB_URL en src/platform/database.ts.
const DB_URL: &str = "sqlite:agente-financiero.db";

/// Migraciones SQL versionadas (fuente única en src/db/migrations).
fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "esquema_inicial",
        sql: include_str!("../../src/db/migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![
            secrets::secret_set,
            secrets::secret_exists,
            secrets::secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Agente Financiero");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn las_migraciones_tienen_versiones_crecientes() {
        let m = migrations();
        assert!(!m.is_empty());
        for pair in m.windows(2) {
            assert!(pair[0].version < pair[1].version);
        }
    }
}
