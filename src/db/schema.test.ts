// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "migrations");
const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const file of migrations) db.exec(readFileSync(join(dir, file), "utf8"));
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

describe("migraciones SQLite", () => {
  it("crean las tablas del modelo de datos mínimo", () => {
    const tables = freshDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual([
      "ai_usage", "analyses", "concept_gaps", "document_requests", "earnings_calendar", "filings", "financial_facts",
      "fx_rates", "peers", "prices", "securities", "splits", "transactions",
    ]);
  });

  it("exigen ticker o ISIN y un tipo válido", () => {
    const db = freshDb();
    expect(() => db.exec("INSERT INTO securities (name, kind, currency) VALUES ('X', 'stock', 'EUR')")).toThrow();
    expect(() => db.exec("INSERT INTO securities (ticker, name, kind, currency) VALUES ('X', 'X', 'bono', 'EUR')")).toThrow();
    db.exec("INSERT INTO securities (isin, name, kind, currency) VALUES ('ES0148396007', 'Inditex', 'stock', 'EUR')");
  });

  it("guardan el origen de cada cifra y rechazan orígenes desconocidos", () => {
    const db = freshDb();
    db.exec("INSERT INTO securities (id, ticker, name, kind, currency) VALUES (1, 'TEST', 'Ficticia (test)', 'stock', 'USD')");
    expect(() =>
      db.exec("INSERT INTO financial_facts (security_id, concept, value, unit, period_end, origin) VALUES (1, 'revenue', 1, 'USD', '2025-12-31', 'inventado')"),
    ).toThrow();
    db.exec("INSERT INTO financial_facts (security_id, concept, value, unit, period_end, origin) VALUES (1, 'revenue', 1, 'USD', '2025-12-31', 'xbrl')");
    const row = db.prepare("SELECT fetched_at FROM financial_facts").get() as { fetched_at: string };
    expect(row.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("borran en cascada los datos de un valor eliminado", () => {
    const db = freshDb();
    db.exec("INSERT INTO securities (id, ticker, name, kind, currency) VALUES (1, 'TEST', 'Ficticia (test)', 'stock', 'USD')");
    db.exec("INSERT INTO prices (security_id, date, interval, close, currency, source) VALUES (1, '2026-01-01', '1mo', 10, 'USD', 'test')");
    db.exec("DELETE FROM securities WHERE id = 1");
    expect((db.prepare("SELECT COUNT(*) AS n FROM prices").get() as { n: number }).n).toBe(0);
  });
});
