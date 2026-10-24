import { CircleAlert, CircleCheck, CircleMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RiskLevel } from "@/domain/technical/risk";
import { cn } from "@/lib/cn";

const STYLE = {
  Bajo: { tone: "positive", Icon: CircleCheck },
  Medio: { tone: "warning", Icon: CircleMinus },
  Alto: { tone: "negative", Icon: CircleAlert },
} as const;

/** Semáforo de riesgo técnico: color, icono y texto (nunca solo color). */
export function RiskBadge({ level, className }: { level: RiskLevel | null; className?: string }) {
  if (!level) return <Badge className={cn("text-[12px]", className)}>Sin datos</Badge>;
  const { tone, Icon } = STYLE[level];
  return (
    <Badge tone={tone} className={cn("text-[12px]", className)}>
      <Icon aria-hidden /> Riesgo {level.toLowerCase()}
    </Badge>
  );
}
