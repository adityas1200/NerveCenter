import { MoreHorizontal } from "lucide-react";
import { Fragment, type ComponentType } from "react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * The `•••` menu that holds every secondary action of a page or a row. Headers keep one primary
 * button; everything else lives here so the top of a page stays quiet.
 */

export interface MenuItem {
  label: string;
  /** A lucide icon or a brand logo; it receives a size className. */
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Draw a hairline above this item. */
  divider?: boolean;
}

export type MenuEntry = MenuItem | null | undefined | false;

export function OverflowMenu({ items, label = "More actions", align = "end", className }: { items: MenuEntry[]; label?: string; align?: "start" | "end"; className?: string }) {
  const visible = items.filter((item): item is MenuItem => Boolean(item));
  if (!visible.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("h-8 w-8 rounded-lg text-ink-4 hover:bg-surface-subtle hover:text-ink-1 data-[state=open]:bg-surface-subtle data-[state=open]:text-ink-1", className)} aria-label={label}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      {/* Radix portals this content out to the end of <body>, well outside the row's own DOM subtree.
          OpsRow's "click anywhere opens the row" handler walks up from the real click target looking
          for a,button,input,...,[data-no-row-open] - so without this attribute here, choosing an item
          in a portalled menu on a clickable row would both run the item's action AND open the row. */}
      <DropdownMenuContent align={align} data-no-row-open>
        {visible.map((item, index) => (
          <Fragment key={item.label}>
            {item.divider && index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem disabled={item.disabled} onSelect={() => item.onSelect()} className={item.destructive ? "text-rose-700 data-[highlighted]:bg-rose-50 data-[highlighted]:text-rose-800" : undefined}>
              {item.icon ? <item.icon className={cn("h-3.5 w-3.5", item.destructive ? "text-rose-600" : "text-ink-4")} aria-hidden="true" /> : null}
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
