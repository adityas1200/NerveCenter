import { Search, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

type SearchInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name; also the placeholder when none is given. */
  label: string;
  /** Classes for the wrapper, which sets the width and flex behaviour. */
  className?: string;
  inputClassName?: string;
};

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The list-page search box. The icon sits above the input's blurred layer (without `z-10`
 * `backdrop-blur` paints over it), picks up the brand violet on focus, and the right edge holds a
 * clear button once there is a query. `/` still focuses the box from anywhere on the page (no
 * visible hint for it); Escape clears the query, then blurs.
 */
const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onValueChange, label, placeholder, className, inputClassName, onKeyDown, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement);
    const hasValue = value.length > 0;

    React.useEffect(() => {
      const onSlash = (event: KeyboardEvent) => {
        if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
        event.preventDefault();
        innerRef.current?.focus();
      };
      window.addEventListener("keydown", onSlash);
      return () => window.removeEventListener("keydown", onSlash);
    }, []);

    const clear = () => {
      onValueChange("");
      innerRef.current?.focus();
    };

    return (
      <div className={cn("group relative", className)}>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-ink-5 transition-all duration-200 ease-out group-focus-within:scale-110 group-focus-within:text-violet-500"
          aria-hidden="true"
        />
        <Input
          ref={innerRef}
          aria-label={label}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented || event.key !== "Escape") return;
            if (hasValue) onValueChange("");
            else event.currentTarget.blur();
          }}
          placeholder={placeholder ?? label}
          className={cn(
            "h-9 pl-9 pr-10 duration-200 ease-out hover:border-violet-200 hover:bg-raised/78 focus:shadow-[0_6px_20px_-12px_rgba(124,58,237,0.45)]",
            inputClassName,
          )}
          {...props}
        />
        {hasValue ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 z-10 grid h-5 w-5 -translate-y-1/2 animate-fade-in place-items-center rounded-full text-ink-4 transition-colors hover:bg-violet-50 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";

export { SearchInput };
