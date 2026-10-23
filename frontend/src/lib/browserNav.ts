/** Full-page navigation to another document. A module of its own so tests can observe it (jsdom cannot navigate). */
export function leavePageTo(url: string): void {
  window.location.replace(url);
}
