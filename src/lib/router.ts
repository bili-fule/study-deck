import { useSyncExternalStore } from "react";

function subscribe(callback: () => void): () => void {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function snapshot(): string {
  return window.location.hash.replace(/^#/, "") || "/";
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, snapshot, () => "/");
}

export function navigate(path: string): void {
  const next = path.startsWith("/") ? path : `/${path}`;
  if (window.location.hash !== `#${next}`) window.location.hash = next;
}

export function routePath(route: string): string {
  return route.split("?")[0] || "/";
}

export function routeQuery(route: string): URLSearchParams {
  return new URLSearchParams(route.split("?")[1] ?? "");
}
