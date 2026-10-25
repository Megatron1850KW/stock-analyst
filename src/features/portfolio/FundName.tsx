import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/** Nombre de un ETF/ETC: el nombre completo en negrita y debajo «Ticker : ISIN» en gris. */
export function FundName({ name, ticker, isin, kind, className, nameClassName }: { name: string; ticker: string; isin: string | null; kind: string; className?: string; nameClassName?: string }) {
  const code = isin && isin !== ticker ? `${ticker} : ${isin}` : ticker;
  return (
    <div className={cn("min-w-0", className)}>
      <p className={cn("text-[13.5px] leading-snug font-semibold", nameClassName)} title={name}>
        {name} <Badge className="ml-1 align-[1px]">{kind.toUpperCase()}</Badge>
      </p>
      <p className="mt-0.5 text-[12px] text-muted tabular" data-selectable>{code}</p>
    </div>
  );
}
