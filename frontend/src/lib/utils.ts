import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** First letter upper-cased; empty or missing text gives "". */
export function capitalise(text?: string | null): string {
  const value = String(text || "");
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

/** "1 row", "3 rows"; pass `many` for an irregular plural. */
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
