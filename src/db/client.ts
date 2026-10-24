/**
 * Interfaz mínima de base de datos. En la app la implementa tauri-plugin-sql
 * (src/platform/database.ts); en los tests, node:sqlite con las mismas
 * migraciones. Los parámetros van con "?" (válido en ambos).
 */
export interface Db {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}
