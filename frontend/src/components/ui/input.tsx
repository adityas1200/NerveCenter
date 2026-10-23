import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-lg border border-line bg-raised px-3 text-[14px] text-ink-1 shadow-[0_1px_1px_rgb(9_9_11/0.03)] transition-[border-color,box-shadow] placeholder:text-ink-5 hover:border-line-strong focus:border-brand/60 focus:outline-none focus:ring-[3px] focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
