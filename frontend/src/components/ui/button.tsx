/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[14px] font-semibold tracking-normal transition-[background-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/30",
  {
    variants: {
      variant: {
        default: "bg-ink-1 text-raised shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_1px_2px_rgb(9_9_11/0.2)] hover:bg-ink-2",
        primary: "bg-brand text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(9_9_11/0.18)] hover:bg-brand-hover",
        secondary:
          "surface-hover border-transparent bg-transparent text-ink-3 shadow-none hover:text-ink-1",
        outline:
          "surface-hover border-transparent bg-transparent text-ink-3 shadow-none hover:text-ink-1",
        ghost: "text-ink-3 hover:bg-ink-1/[0.05] hover:text-ink-1",
        destructive: "bg-rose-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] hover:bg-rose-700",
        link: "h-auto rounded-none p-0 text-brand hover:text-brand-hover hover:underline",
      },
      size: {
        default: "h-9 px-4 text-[13.5px]",
        sm: "h-8 px-3 text-[13px]",
        // Inside a table row, so a row with a button is as tall as one without.
        xs: "h-7 px-2.5 text-[12.5px]",
        lg: "h-11 px-5 text-[14.5px]",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  busy?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = "button", busy = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
        disabled={busy || props.disabled}
        aria-busy={busy || props["aria-busy"]}
      >{asChild ? children : <>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{children}</>}</Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
