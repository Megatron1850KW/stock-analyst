import { Star } from "lucide-react";
import { PageHeader } from "@/app/PageHeader";
import { EmptyState } from "@/app/EmptyState";
import { SECTIONS } from "@/app/sections";

const section = SECTIONS[3]!;

export function StarsPage() {
  return (
    <div className="mx-auto max-w-[1080px]">
      <PageHeader title={section.title} subtitle={section.subtitle} />
      <EmptyState
        icon={Star}
        title="Todavía no hay estrellas"
        description="La app marcará con una estrella la mejor siguiente compra de tu watchlist y la posición de tu cartera más barata hoy, siempre con 2 o 3 razones a la vista."
        upcoming="Disponible en la fase 9"
      />
    </div>
  );
}
