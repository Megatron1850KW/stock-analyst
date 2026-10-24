import { Plus, WalletCards } from "lucide-react";
import { PageHeader } from "@/app/PageHeader";
import { EmptyState } from "@/app/EmptyState";
import { SECTIONS } from "@/app/sections";
import { Button } from "@/components/ui/button";

const section = SECTIONS[1]!;

export function PortfolioPage() {
  return (
    <div className="mx-auto max-w-[1080px]">
      <PageHeader
        title={section.title}
        subtitle={section.subtitle}
        actions={
          <Button disabled>
            <Plus aria-hidden /> Nueva operación
          </Button>
        }
      />
      <EmptyState
        icon={WalletCards}
        title="Registra tu primera operación"
        description="Apunta tus compras de acciones, ETFs y ETCs con fecha, cantidad, precio y comisiones. Verás tu rentabilidad en euros, el peso de cada posición y una recomendación de Comprar más o Mantener."
        upcoming="Disponible en la fase 7"
      />
    </div>
  );
}
