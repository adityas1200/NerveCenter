import { useLayoutEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Router } from "react-router-dom";
import { APP_BASE, SlugContext, appHistory, goTo, projectPath, projectSlugOf } from "@/lib/appRouterCore";

/** The app's router: browser history, with the basename following the project in the address (SPEC-projects-03 FR-14). */
export function AppRouter({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ action: appHistory.action, location: appHistory.location });
  useLayoutEffect(() => appHistory.listen(({ action, location }) => setState({ action, location })), []);
  const slug = projectSlugOf(state.location.pathname);
  const basename = slug ? `${APP_BASE}${projectPath(slug)}` : APP_BASE || "/";
  return (
    <SlugContext.Provider value={slug}>
      <Router basename={basename} location={state.location} navigationType={state.action} navigator={appHistory}>
        {children}
      </Router>
    </SlugContext.Provider>
  );
}

/** An anchor to a path outside the current project (home, admin console, another project). */
export function OutsideLink({ to, className, children, onClick, ...rest }: { to: string; className?: string; children: ReactNode; onClick?: () => void; "aria-label"?: string; title?: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.();
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goTo(to);
  };
  return <a href={`${APP_BASE}${to}`} className={className} onClick={follow} {...rest}>{children}</a>;
}
