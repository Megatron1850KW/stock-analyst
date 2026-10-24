import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { countryName } from "@/domain/portfolio/sector";
import { formatCurrency, formatPercent, SIN_DATO } from "@/lib/format";
import type { Holding } from "./load";
import { ActionBadge } from "./PositionCard";

/** ETFs y ETCs de tu cartera frente a frente (§5.5): coste, qué siguen, tendencia y peso. Sin estados financieros. */
export function FundsTable({ holdings }: { holdings: Holding[] }) {
  const head = "px-3 py-2 text-left text-[11.5px] font-medium text-muted";
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface-raised shadow-card">
      <table className="w-full min-w-[860px] border-collapse text-[13px]">
        <caption className="sr-only">ETFs y ETCs de tu cartera</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={`${head} pl-5`}>Fondo</th>
            <th scope="col" className={head}>Qué sigue</th>
            <th scope="col" className={head}>Coste anual</th>
            <th scope="col" className={head}>Réplica · domicilio</th>
            <th scope="col" className={head}>Tendencia de fondo</th>
            <th scope="col" className={head}>Valor · peso</th>
            <th scope="col" className={head}>Recomendación</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const f = h.fund?.profile;
            const up = h.trend ? h.trend.price >= h.trend.average : null;
            return (
              <tr key={h.row.id} className="border-b border-border align-middle last:border-0">
                <th scope="row" className="py-3 pr-3 pl-5 text-left font-normal">
                  <span className="font-serif text-[16px] font-semibold tracking-tight">{h.row.ticker}</span> <Badge>{h.row.kind.toUpperCase()}</Badge>
                  <p className="max-w-[200px] truncate text-[12px] text-muted" title={h.row.name}>{h.row.name}</p>
                </th>
                <td className="max-w-[200px] truncate px-3 py-3" title={f?.index ?? undefined}>{f?.index ?? <span className="text-muted">{SIN_DATO}</span>}</td>
                <td className="px-3 py-3 tabular">{f?.ter != null ? formatPercent(f.ter, 2) : <span className="text-muted">{SIN_DATO}</span>}</td>
                <td className="px-3 py-3 text-[12.5px]">
                  {f?.replication ?? <span className="text-muted">{SIN_DATO}</span>}
                  {f?.domicile && <span className="text-muted"> · {countryName(f.domicile)}</span>}
                </td>
                <td className="px-3 py-3">
                  {up === null ? (
                    <span className="text-muted">{SIN_DATO}</span>
                  ) : (
                    <Badge tone={up ? "positive" : "negative"} className="text-[12px]">
                      {up ? <ArrowUpRight aria-hidden /> : <ArrowDownRight aria-hidden />} {up ? "Alcista" : "Bajista"}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-3 tabular">
                  {h.position.valueEur !== null ? formatCurrency(h.position.valueEur, "EUR", 0) : <span className="text-muted">{SIN_DATO}</span>}
                  {h.position.weight !== null && <span className="text-muted"> · {formatPercent(h.position.weight, 1)}</span>}
                </td>
                <td className="px-3 py-3">
                  <Tooltip content={<ul className="list-disc pl-4">{h.recommendation.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}>
                    <span tabIndex={0}><ActionBadge action={h.recommendation.action} /></span>
                  </Tooltip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
