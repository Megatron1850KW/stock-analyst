/**
 * Mapa de calor tipo «treemap»: reparte un rectángulo entre valores de forma
 * proporcional a su tamaño, buscando cuadros lo más cuadrados posible
 * (algoritmo «squarified» de Bruls, Huizing y van Wijk). Lógica pura, sin UI.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Sized<T> {
  item: T;
  size: number;
}

export type Placed<T> = Rect & { item: T };

/** Peor relación de aspecto de una fila colocada a lo largo de un lado de longitud `side`. */
function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  if (sum <= 0 || side <= 0) return Infinity;
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Coloca los elementos (de mayor a menor) dentro de `bounds`. El área de cada
 * cuadro es proporcional a su tamaño; los de tamaño 0 o negativo se descartan.
 */
export function squarify<T>(items: Sized<T>[], bounds: Rect): Placed<T>[] {
  const list = items.filter((i) => Number.isFinite(i.size) && i.size > 0).sort((a, b) => b.size - a.size);
  const total = list.reduce((a, b) => a + b.size, 0);
  if (total <= 0 || bounds.w <= 0 || bounds.h <= 0) return [];
  const scale = (bounds.w * bounds.h) / total;
  const areas = list.map((i) => i.size * scale);

  const out: Placed<T>[] = [];
  let free: Rect = { ...bounds };
  let i = 0;
  while (i < list.length) {
    const side = Math.min(free.w, free.h);
    const row: number[] = [areas[i]!];
    let j = i + 1;
    while (j < list.length && worst([...row, areas[j]!], side) <= worst(row, side)) row.push(areas[j++]!);

    // Fila pegada al lado corto del hueco libre
    const sum = row.reduce((a, b) => a + b, 0);
    const horizontal = free.w >= free.h; // columna a la izquierda si el hueco es apaisado
    const thick = sum / side;
    let offset = 0;
    row.forEach((area, k) => {
      const len = area / thick;
      out.push(
        horizontal
          ? { item: list[i + k]!.item, x: free.x, y: free.y + offset, w: thick, h: len }
          : { item: list[i + k]!.item, x: free.x + offset, y: free.y, w: len, h: thick },
      );
      offset += len;
    });
    free = horizontal ? { x: free.x + thick, y: free.y, w: free.w - thick, h: free.h } : { x: free.x, y: free.y + thick, w: free.w, h: free.h - thick };
    i = j;
  }
  return out;
}

export interface Group<T> {
  name: string;
  items: Sized<T>[];
}

export type PlacedGroup<T> = Rect & { name: string; size: number; cells: Placed<T>[] };

/**
 * Dos niveles, como los mapas por sectores: primero se reparten los grupos por
 * su tamaño total y luego, dentro de cada grupo (bajo una franja de `header`
 * píxeles para su nombre), sus elementos.
 */
export function squarifyGroups<T>(groups: Group<T>[], bounds: Rect, { header = 0, gap = 0 }: { header?: number; gap?: number } = {}): PlacedGroup<T>[] {
  const sized = groups
    .map((g) => {
      const total = g.items.reduce((a, b) => a + (b.size > 0 ? b.size : 0), 0);
      return { item: { ...g, total }, size: total };
    })
    .filter((g) => g.size > 0);
  return squarify(sized, bounds).map((g) => {
    const inner: Rect = { x: g.x + gap, y: g.y + header + gap, w: Math.max(0, g.w - 2 * gap), h: Math.max(0, g.h - header - 2 * gap) };
    return { x: g.x, y: g.y, w: g.w, h: g.h, name: g.item.name, size: g.item.total, cells: squarify(g.item.items, inner) };
  });
}

/**
 * Tramos de color que pidió Pablo para la variación de 6 meses:
 * subida fuerte (más de +20 %), subida moderada (+5 % a +20 %), neutra
 * (entre −5 % y +5 %), caída moderada (−5 % a −20 %) y caída fuerte (más de −20 %).
 */
export type HeatBand = "strongUp" | "up" | "flat" | "down" | "strongDown";

export const HEAT_STRONG = 0.2;
export const HEAT_FLAT = 0.05;

export function heatBand(change: number | null): HeatBand | null {
  if (change === null || !Number.isFinite(change)) return null;
  if (change > HEAT_STRONG) return "strongUp";
  if (change >= HEAT_FLAT) return "up";
  if (change > -HEAT_FLAT) return "flat";
  if (change >= -HEAT_STRONG) return "down";
  return "strongDown";
}
