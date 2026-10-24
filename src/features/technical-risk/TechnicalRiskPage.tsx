import { CandlestickChart } from "lucide-react";
import { PageHeader } from "@/app/PageHeader";
import { EmptyState } from "@/app/EmptyState";
import { SECTIONS } from "@/app/sections";

const section = SECTIONS[2]!;

export function TechnicalRiskPage() {
  return (
    <div className="mx-auto max-w-[1080px]">
      <PageHeader title={section.title} subtitle={section.subtitle} />
      <EmptyState
        icon={CandlestickChart}
        title="Aún no hay valores que revisar"
        description="Cuando tengas valores en la watchlist o en la cartera, aquí verás sus velas mensuales de 10 años y un semáforo de riesgo (bajo, medio o alto) explicado en una frase. Nada de gráficos intradía."
        upcoming="Disponible en la fase 8"
      />
    </div>
  );
}
