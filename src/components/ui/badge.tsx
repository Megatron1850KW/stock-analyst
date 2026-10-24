import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-surface text-muted",
        accent: "bg-accent/12 text-accent-text",
        positive: "bg-positive/12 text-positive-text",
        warning: "bg-warning/15 text-warning-text",
        negative: "bg-negative/12 text-negative-text",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
