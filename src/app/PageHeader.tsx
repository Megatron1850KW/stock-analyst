import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-6 pb-8">
      <div>
        <h1 className="font-serif text-[30px] leading-tight font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 max-w-[60ch] text-[14px] text-muted">{subtitle}</p>
      </div>
      {actions}
    </header>
  );
}
