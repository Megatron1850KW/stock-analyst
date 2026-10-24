mod claude;
mod documents;
mod eu;
mod fx;
mod http;
mod prices;
mod sec;
mod secrets;

use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Debe coincidir con DB_URL en src/platform/database.ts.
const DB_URL: &str = "sqlite:agente-financiero.db";

/// Migraciones SQL versionadas (fuente única en src/db/migrations).
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "esquema_inicial",
            sql: include_str!("../../src/db/migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "datos_sec",
            sql: include_str!("../../src/db/migrations/0002_sec.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "ficha",
            sql: include_str!("../../src/db/migrations/0003_ficha.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "competidores",
            sql: include_str!("../../src/db/migrations/0004_peers.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "europa",
            sql: include_str!("../../src/db/migrations/0005_europe.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "simbolos de precios",
            sql: include_str!("../../src/db/migrations/0006_price_symbols.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "cartera",
            sql: include_str!("../../src/db/migrations/0007_portfolio.sql"),
            kind: MigrationKind::Up,
        },
    ]
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            secrets::secret_set,
            secrets::secret_exists,
            secrets::secret_delete,
            sec::sec_fetch,
            sec::sec_document,
            eu::eu_fetch,
            eu::esef_document,
            eu::esef_report,
            claude::claude_request,
            prices::price_quote,
            prices::price_history,
            prices::price_splits,
            prices::price_series,
            prices::price_search,
            fx::fx_series,
            documents::document_store,
            documents::document_open,
            documents::document_delete,
            documents::document_read_pdf,
            documents::document_esef_report
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
