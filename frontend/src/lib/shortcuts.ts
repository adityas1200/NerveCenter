import { APP_PAGES } from "@/lib/appSections";

/**
 * Keyboard shortcuts across the app. One place for what each key does, so the command palette can
 * show the same keys the handlers listen for.
 *
 * - Ctrl K (⌘K on a Mac): the command palette.
 * - Ctrl J (⌘J): the Sonic panel.
 * - C: a new task.
 * - G then a letter: go to a page (G O Overview, G T Tickets, …).
 * - /: the search box on a list page.
 */

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** The modifier as people see it on their keyboard: "⌘" on a Mac, "Ctrl" elsewhere. */
export const MOD = isMac ? "⌘" : "Ctrl";

export const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** A plain key press: no modifier, not typed into a field, and no dialog or menu open over the page. */
export function isPlainKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || isEditableTarget(event.target)) return false;
  return !document.querySelector('[role="dialog"][data-state="open"], [role="menu"], [role="listbox"], [role="alertdialog"]');
}

/** G-then-letter page shortcuts. The letter is the page's first letter where it is free. */
export const GO_KEYS: Record<string, string> = Object.fromEntries(APP_PAGES.map((page) => [page.to, page.goKey]));
