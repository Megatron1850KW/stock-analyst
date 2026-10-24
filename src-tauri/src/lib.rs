mod claude;
mod documents;
mod eu;
mod fx;
mod http;
mod prices;
mod sec;
mod secrets;
mod tray;

use tauri::{Manager, WindowEvent};
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
        Migration {
            version: 8,
            description: "reintentar simbolos",
            sql: include_str!("../../src/db/migrations/0008_retry_symbols.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "autonomia",
            sql: include_str!("../../src/db/migrations/0009_autonomy.sql"),
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
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![tray::HIDDEN_ARG])))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            tray::setup(app.handle())?;
            if tray::started_hidden(std::env::args()) {
                if let Some(w) = app.get_webview_window("main") {
                    w.hide()?;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar la ventana la oculta: la app sigue en la barra de menús
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
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
            documents::document_reveal,
            documents::document_delete,
            documents::document_read_pdf,
            documents::document_esef_report
        ])
        .build(tauri::generate_context!())
        .expect("error al iniciar Stock Analisis")
        .run(|app, event| {
            // Clic en el icono del Dock con la ventana oculta: se vuelve a mostrar
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_main(app);
            }
            let _ = (app, event);
        });
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
