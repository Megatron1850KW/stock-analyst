import { describe, expect, it } from "vitest";
import { heatIntensity, squarify, squarifyGroups } from "./treemap";

// DATOS FICTICIOS para tests.
const area = (r: { w: number; h: number }) => r.w * r.h;

describe("treemap", () => {
  const bounds = { x: 0, y: 0, w: 600, h: 400 };

  it("cada cuadro ocupa un área proporcional a su tamaño y se llena todo", () => {
    const placed = squarify([6, 6, 4, 3, 2, 2, 1].map((size, i) => ({ item: `T${i}`, size })), bounds);
    expect(placed).toHaveLength(7);
    const total = 24;
    for (const p of placed) {
      const size = [6, 6, 4, 3, 2, 2, 1][Number(p.item.slice(1))]!;
      expect(area(p)).toBeCloseTo((size / total) * 600 * 400, 6);
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x + p.w).toBeLessThanOrEqual(600 + 1e-9);
      expect(p.y + p.h).toBeLessThanOrEqual(400 + 1e-9);
    }
    expect(placed.reduce((a, p) => a + area(p), 0)).toBeCloseTo(600 * 400, 6);
  });

  it("no se solapan", () => {
    const placed = squarify([5, 4, 3, 3, 2, 1, 1, 1].map((size, i) => ({ item: i, size })), bounds);
    for (let a = 0; a < placed.length; a++)
      for (let b = a + 1; b < placed.length; b++) {
        const p = placed[a]!, q = placed[b]!;
        const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
        const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
        expect(ox <= 1e-6 || oy <= 1e-6).toBe(true);
      }
  });

  it("tamaños iguales dan cuadros parecidos y descarta tamaños nulos", () => {
    const placed = squarify([1, 1, 1, 1, 0, -2].map((size, i) => ({ item: i, size })), { x: 0, y: 0, w: 200, h: 200 });
    expect(placed).toHaveLength(4);
    for (const p of placed) expect(Math.max(p.w / p.h, p.h / p.w)).toBeLessThan(1.01);
  });

  it("agrupa por sectores y deja sitio al título del grupo", () => {
    const groups = squarifyGroups(
      [
        { name: "Tecnología", items: [{ item: "A", size: 3 }, { item: "B", size: 1 }] },
        { name: "Energía", items: [{ item: "C", size: 4 }] },
        { name: "Vacío", items: [] },
      ],
      bounds,
      { header: 20 },
    );
    expect(groups.map((g) => g.name).sort()).toEqual(["Energía", "Tecnología"]);
    for (const g of groups) {
      expect(area(g)).toBeCloseTo(600 * 400 * (g.size / 8), 6);
      for (const c of g.cells) expect(c.y).toBeGreaterThanOrEqual(g.y + 20 - 1e-9);
    }
  });

  it("satura el color en ±30 % y sin dato no colorea", () => {
    expect(heatIntensity(0.15)).toBeCloseTo(0.5);
    expect(heatIntensity(-0.6)).toBe(-1);
    expect(heatIntensity(null)).toBeNull();
  });
});
