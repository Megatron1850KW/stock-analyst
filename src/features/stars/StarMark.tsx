import { Star as StarIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import type { Star } from "@/domain/scoring/stars";
import { cn } from "@/lib/cn";
import { useStars } from "./queries";

export const STAR_TITLE = {
  watchlist: "Mejor siguiente compra",
  portfolio: "La más barata de tu cartera hoy",
} as const;

/** El porqué de una estrella: 2 o 3 razones y, si lo hay, un aviso. */
export function StarReasons({ star, which }: { star: Star; which: keyof typeof STAR_TITLE }) {
  return (
    <div>
      <p className="font-medium">⭐ {STAR_TITLE[which]}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {star.reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      {star.caution && <p className="mt-1.5 text-warning-text">{star.caution}</p>}
    </div>
  );
}

/** ⭐ junto al ticker si tiene la estrella de la watchlist o de la cartera, con su porqué al pasar el ratón o con el teclado. */
export function StarMark({ id, which, className }: { id: number; which: keyof typeof STAR_TITLE; className?: string }) {
  const { data } = useStars();
  const star = data?.[which].star;
  if (!star || star.id !== id) return null;
  return (
    <Tooltip content={<StarReasons star={star} which={which} />}>
      <span
        tabIndex={0}
        role="img"
        aria-label={`Estrella: ${STAR_TITLE[which].toLowerCase()}`}
        onClick={(e) => e.stopPropagation()}
        className={cn("inline-flex cursor-help items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent", className)}
      >
        <StarIcon className="size-4 fill-accent text-accent" aria-hidden />
      </span>
    </Tooltip>
  );
}
