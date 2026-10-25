//! Barra de menús (CLAUDE.md §7): al cerrar la ventana la app sigue viva en la
//! barra de menús para la comprobación diaria de informes. Solo «Salir» la cierra.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Evento que recibe la interfaz para comprobar informes nuevos ya.
pub const CHECK_EVENT: &str = "check-reports";
/// Argumento con el que arranca el inicio automático: sin abrir la ventana.
pub const HIDDEN_ARG: &str = "--hidden";

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir Stock Analisis", true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check", "Comprobar informes nuevos", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &check, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Stock Analisis")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "check" => {
                let _ = app.emit(CHECK_EVENT, ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// ¿Se lanzó desde el inicio automático (sin ventana)?
pub fn started_hidden(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().any(|a| a == HIDDEN_ARG)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_inicio_automatico_arranca_sin_ventana() {
        assert!(started_hidden(["app".to_string(), "--hidden".to_string()]));
        assert!(!started_hidden(["app".to_string()]));
    }
}
