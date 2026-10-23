import type { ReactNode } from "react";
import { ALL } from "@/lib/useUrlFilters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui";

export interface FilterOption { value: string; label: ReactNode; className?: string }

/**
 * A filter dropdown for a list toolbar: the trigger shows the filter's name until something is picked
 * and is outlined while a filter is on; the first item clears it ("All statuses").
 */
export function FilterSelect({ label, plural, value, onChange, options, className = "w-[150px]", all = ALL }: {
  label: string; plural: string; value: string; onChange: (value: string) => void; options: FilterOption[]; className?: string; all?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`h-9 ${className} ${value !== all ? "border-ink-1" : ""}`} aria-label={`Filter by ${label.toLowerCase()}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={all}>{value === all ? label : `All ${plural}`}</SelectItem>
        {options.map((option) => <SelectItem key={option.value} value={option.value} className={option.className}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
