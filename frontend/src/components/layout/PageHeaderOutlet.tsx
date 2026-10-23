import { createContext, useContext } from "react";

export const PageHeaderOutletContext = createContext<HTMLElement | null>(null);

/** The slot at the top of the page content where the large title sits. Null on full-bleed pages, which keep their title in the top bar. */
export const PageTitleOutletContext = createContext<HTMLElement | null>(null);

export function usePageHeaderOutlet() {
  return useContext(PageHeaderOutletContext);
}

export function usePageTitleOutlet() {
  return useContext(PageTitleOutletContext);
}
