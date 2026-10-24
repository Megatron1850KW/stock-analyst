// Evita una consola extra en Windows en release; no afecta a macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    agente_financiero_lib::run()
}
