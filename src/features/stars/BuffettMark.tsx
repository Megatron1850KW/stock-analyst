import { Tooltip } from "@/components/ui/tooltip";
import { buffettReasons, type BuffettRow } from "@/domain/scoring/buffett";
import { cn } from "@/lib/cn";
import { useStars } from "./queries";

export const BUFFETT_TITLE = {
  watchlist: "Criterio Buffett: la compraría hoy",
  portfolio: "Criterio Buffett: compraría más hoy",
} as const;

/** La letra «B» en azul Klein, del mismo tamaño que la estrella. */
export function BuffettGlyph({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-grid size-4 place-items-center font-serif text-[15px] leading-none font-bold text-klein", className)}>B</span>;
}

/** El porqué de una «B»: lo que más pesa de sus criterios. */
export function BuffettReasons({ row, which }: { row: BuffettRow; which: keyof typeof BUFFETT_TITLE }) {
  return (
    <div>
      <p className="font-medium"><BuffettGlyph className="mr-1 align-[-2px]" /> {BUFFETT_TITLE[which]}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {buffettReasons(row).map((r) => <li key={r}>{r}</li>)}
      </ul>
    </div>
  );
}

/** «B» junto al ticker (y junto a la ⭐ si la tiene) cuando cumple el criterio Buffett. */
export function BuffettMark({ id, which, className }: { id: number; which: keyof typeof BUFFETT_TITLE; className?: string }) {
  const { data } = useStars();
  const row = data?.buffett[which].picks.find((r) => r.input.id === id);
  if (!row) return null;
  return (
    <Tooltip content={<BuffettReasons row={row} which={which} />}>
      <span
        tabIndex={0}
        role="img"
        aria-label={BUFFETT_TITLE[which]}
        onClick={(e) => e.stopPropagation()}
        className={cn("inline-flex cursor-help items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-klein", className)}
      >
        <BuffettGlyph />
      </span>
    </Tooltip>
  );
}
