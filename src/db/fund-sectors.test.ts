// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getFundProfiles } from "@/features/portfolio/fund-profile";
import { memoryDb } from "../../tests/helpers/sqlite-db";

// Valores con los ISIN de los fondos; la ficha previa de VUSA es FICTICIA.
const SQL = readFileSync(join(__dirname, "migrations/0010_fund_sectors.sql"), "utf8");

describe("migración 0010: sectores de los fondos", () => {
  it("guarda el reparto en las fichas que existen y crea las que faltan, sin tocar el resto de la ficha", async () => {
    const db = memoryDb();
    const add = (id: number, isin: string, name: string, kind = "etf") =>
      db.raw.prepare("INSERT INTO securities (id, ticker, isin, name, kind, currency) VALUES (?, ?, ?, ?, ?, 'EUR')").run(id, `T${id}`, isin, name, kind);
    add(1, "IE00B3XXRP09", "Vanguard S&P 500 UCITS ETF");
    add(2, "IE000COQKPO9", "Invesco NASDAQ-100 ESG");
    add(3, "DE000A2T0VU5", "Xtrackers IE Physical Gold ETC", "etc");
    add(4, "LU1681044720", "Amundi MSCI Switzerland UCITS ETF");
    add(5, "IE00FICTICIO", "Otro fondo ficticio");
    db.raw
      .prepare("INSERT INTO fund_profiles (security_id, profile_json, origin) VALUES (1, ?, 'pdf-extraction')")
      .run(JSON.stringify({ ter: 0.0007, index: "S&P 500", replication: null, domicile: "IE", aumMillions: null, aumCurrency: null, fundCurrency: "USD", distribution: null, collateral: null, holdings: [{ name: "Ficticia", weight: 0.07 }], sectors: [{ key: "Tecnología", weight: 0.3 }], countries: [], asOf: null, pages: {}, notes: [] }));

    db.raw.exec(SQL);
    const p = await getFundProfiles(db);
    expect(p.get(1)!.profile.ter).toBe(0.0007);
    expect(p.get(1)!.profile.holdings).toHaveLength(1);
    expect(p.get(1)!.profile.sectors).toHaveLength(11);
    expect(p.get(1)!.profile.sectors[0]).toEqual({ key: "Tecnología", weight: 0.3971 });
    expect(p.get(1)!.origin).toBe("user");
    expect(p.get(2)!.profile.sectors).toEqual([{ key: "Tecnología", weight: 1 }]);
    expect(p.get(3)!.profile.sectors).toEqual([{ key: "Materias primas", weight: 1 }]);
    expect(p.get(4)!.profile.sectors[0]).toEqual({ key: "Salud", weight: 0.4047 });
    expect(p.has(5)).toBe(false);
  });
});
