/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const scrollAreaVariants = cva(
  "relative [scrollbar-width:thin] [&::-webkit-scrollbar-corner]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-0 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5",
  {
    variants: {
      orientation: {
        vertical: "overflow-y-auto overflow-x-hidden",
        horizontal: "overflow-x-auto overflow-y-hidden",
        both: "overflow-auto",
      },
      tone: {
        default:
          "[scrollbar-color:rgba(15,23,42,0.22)_transparent] [&::-webkit-scrollbar-thumb:hover]:bg-ink-5/70 [&::-webkit-scrollbar-thumb]:bg-ink-5/45",
        dark: "[scrollbar-color:rgba(255,255,255,0.28)_transparent] [&::-webkit-scrollbar-thumb:hover]:bg-raised/40 [&::-webkit-scrollbar-thumb]:bg-raised/20",
      },
    },
    defaultVariants: {
      orientation: "vertical",
      tone: "default",
    },
  },
);

export interface ScrollAreaProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof scrollAreaVariants> {
  maxHeight?: number | string;
  maxWidth?: number | string;
}

function toCssSize(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, orientation, tone, maxHeight, maxWidth, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(scrollAreaVariants({ orientation, tone }), className)}
      style={{ maxHeight: toCssSize(maxHeight), maxWidth: toCssSize(maxWidth), ...style }}
      {...props}
    />
  ),
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea, scrollAreaVariants };
