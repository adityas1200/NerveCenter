/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-violet-200 bg-violet-50 text-violet-700",
        secondary: "border-line bg-surface-subtle text-ink-3",
        blue: "border-blue-200 bg-blue-50 text-blue-700",
        indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
        emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
        amber: "border-amber-200 bg-amber-50 text-amber-800",
        rose: "border-rose-200 bg-rose-50 text-rose-700",
        cyan: "border-cyan-200 bg-cyan-50 text-cyan-700",
        orange: "border-orange-200 bg-orange-50 text-orange-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
