/**
 * Mermaid can attach a "bomb" error diagram (its own "Syntax error in text" SVG) directly onto the
 * document.body when a diagram fails to parse or draw - outside React's tree entirely. React never
 * touches document.body itself, so nothing (unmount, route change, our own catch handlers) ever
 * removes one once it lands there; it just sits on every page until a full reload, and a second
 * failure stacks another bomb on top instead of replacing the first.
 *
 * MermaidBlock already sets `suppressErrorRendering: true`, which stops mermaid from creating these
 * going forward - but that only prevents *new* ones, and does nothing for one that already landed
 * (from an older build, a race, or any other path that renders mermaid without that flag). This is
 * the belt-and-suspenders cleanup: sweep for mermaid's own fingerprints - the "d<id>" wrapper div our
 * MermaidBlock's ids produce, or its distinctive ".error-icon" SVG paths - and remove them, wherever
 * they came from. Only ever targets mermaid's own markers, never a real app element (dialogs,
 * tooltips and toasts are legitimate document.body portals and do not match either fingerprint).
 */
export function sweepOrphanedMermaidElements(): void {
  if (typeof document === "undefined") return;
  for (const node of Array.from(document.body.children)) {
    if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) continue;
    const isMermaidWrapper = node.id.startsWith("dnc-mermaid-");
    const hasMermaidErrorMark = typeof node.querySelector === "function" && node.querySelector(".error-icon, .error-text") !== null;
    if (isMermaidWrapper || hasMermaidErrorMark) node.remove();
  }
}
