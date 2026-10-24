import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-lg border border-border bg-bg px-3 text-[13px] text-text placeholder:text-muted/70",
        "transition-colors duration-150 focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/25",
        "disabled:opacity-50 aria-[invalid=true]:border-negative",
        className,
      )}
      {...props}
    />
  );
}
