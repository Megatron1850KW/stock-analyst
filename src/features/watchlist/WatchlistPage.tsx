import { Eye, Plus, Search } from "lucide-react";
import { PageHeader } from "@/app/PageHeader";
import { EmptyState } from "@/app/EmptyState";
import { SECTIONS } from "@/app/sections";
import { Button } from "@/components/ui/button";

const section = SECTIONS[0]!;

export function WatchlistPage() {
  return (
    <div className="mx-auto max-w-[1080px]">
      <PageHeader
        title={section.title}
        subtitle={section.subtitle}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-[260px] items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 text-[13px] text-muted/70" aria-disabled>
              <Search className="size-3.5" aria-hidden />
              <span className="flex-1">Buscar por ticker o ISIN</span>
              <kbd className="font-sans text-[11px]">⌘K</kbd>
            </div>
            <Button disabled>
              <Plus aria-hidden /> Añadir
            </Button>
          </div>
        }
      />
      <EmptyState
        icon={Eye}
        title="Añade tu primer ticker"
        description="Escribe un ticker (AAPL) o un ISIN (ES0148396007). La app buscará sus 3 últimos informes anuales y 3 intermedios y preparará su ficha: negocio, finanzas, valoración y competidores."
        upcoming="Disponible en la fase 2"
      />
    </div>
  );
}
