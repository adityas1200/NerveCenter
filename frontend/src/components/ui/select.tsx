import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      // `[&>span]:truncate` keeps a long selected value (a JQL filter, a table name) inside the trigger.
      "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-raised px-3 text-left text-[14px] font-medium text-ink-1 shadow-sm transition hover:border-line-strong focus:border-brand/60 focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:min-w-0 [&>span]:truncate",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-5" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn("z-[100] max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[8rem] overflow-hidden rounded-xl border border-line bg-raised text-ink-1 shadow-modal", className)}
      position={position}
      sideOffset={4}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex h-7 cursor-default items-center justify-center bg-raised text-ink-4">
        <ChevronUp className="h-3.5 w-3.5" />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport className={cn("max-h-[calc(min(24rem,var(--radix-select-content-available-height))-3.5rem)] p-1", position === "popper" && "min-w-[var(--radix-select-trigger-width)]")}>
        {children}
      </SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex h-7 cursor-default items-center justify-center bg-raised text-ink-4">
        <ChevronDown className="h-3.5 w-3.5" />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn("relative flex w-full cursor-default select-none items-center rounded-lg py-2 pl-8 pr-3 text-[14px] outline-none transition-colors focus:bg-surface-subtle focus:text-ink-1 data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5 text-violet-600" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem };
