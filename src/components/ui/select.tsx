import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Select nativo: en macOS abre el menú del sistema, que es lo esperable. */
export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-8 w-full appearance-none rounded-lg border border-border bg-bg pr-8 pl-3 text-[13px] text-text",
          "focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/25",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
}
