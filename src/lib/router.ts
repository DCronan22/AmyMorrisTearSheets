import { useEffect, useState } from "react";
import type { MouseEvent } from "react";

// A tiny path router for the public pages (home, log in, sign up, terms,
// privacy). The app itself stays a single screen behind sign-in. Vercel
// rewrites every non-API path to index.html, so deep links work.

export type Route = "home" | "login" | "signup" | "terms" | "privacy";

const PATHS: Record<Route, string> = {
  home: "/",
  login: "/login",
  signup: "/signup",
  terms: "/terms",
  privacy: "/privacy",
};

export function pathFor(route: Route): string {
  return PATHS[route];
}

function routeFor(pathname: string): Route {
  const p = pathname.replace(/\/+$/, "") || "/";
  const hit = (Object.keys(PATHS) as Route[]).find((r) => PATHS[r] === p);
  return hit ?? "home";
}

const LISTENERS = new Set<() => void>();

/** Go to a public page without reloading. `replace` skips a history entry. */
export function navigate(route: Route, opts: { replace?: boolean; hash?: string } = {}) {
  const url = PATHS[route] + (opts.hash ? `#${opts.hash}` : "");
  if (opts.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  LISTENERS.forEach((fn) => fn());
  // Wait a tick so a page switch has rendered before scrolling.
  const hash = opts.hash;
  window.setTimeout(() => {
    const el = hash ? document.getElementById(hash) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo(0, 0);
  }, 0);
}

/** The current public route; re-renders on navigate() and back/forward. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFor(window.location.pathname));
  useEffect(() => {
    const update = () => setRoute(routeFor(window.location.pathname));
    LISTENERS.add(update);
    window.addEventListener("popstate", update);
    return () => {
      LISTENERS.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return route;
}

/**
 * onClick for an <a href> that should navigate in-app. Lets the browser handle
 * modified clicks (new tab, etc.) itself.
 */
export function linkTo(route: Route, hash?: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    navigate(route, { hash });
  };
}
