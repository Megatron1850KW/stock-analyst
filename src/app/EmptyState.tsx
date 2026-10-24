import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

export function EmptyState({
  icon: Icon,
  title,
  description,
  upcoming,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  upcoming?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-border px-8 py-16 text-center">
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-sand/60">
        <Icon className="size-6 text-accent-text" aria-hidden />
      </div>
      <h2 className="font-serif text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-muted">{description}</p>
      {children && <div className="mt-6">{children}</div>}
      {upcoming && (
        <Badge tone="accent" className="mt-6">
          {upcoming}
        </Badge>
      )}
    </div>
  );
}
