import { useEffect, useState } from "react";

/**
 * Narrow-viewport detection for the desktop-only roadblock (issue #16, ADR 0003;
 * minimum width raised to 1900px by issue #179): the single source of truth is
 * `matchMedia("(max-width: 1899px)")` with an event-driven `change` listener.
 * `window.innerWidth` is never consulted for logic — CSS media-query rounding
 * governs fractional viewport widths.
 */

export const NARROW_VIEWPORT_QUERY = "(max-width: 1899px)";

/** Minimal matchMedia surface the subscription core needs (node-testable with stubs). */
export interface NarrowViewportSource {
  matches: boolean;
  addChangeListener(listener: (matches: boolean) => void): void;
  removeChangeListener(listener: (matches: boolean) => void): void;
}

type MatchMediaFn = (query: string) => MediaQueryList;

function getMatchMedia(): MatchMediaFn | undefined {
  const scope = globalThis as { matchMedia?: MatchMediaFn };
  return typeof scope.matchMedia === "function" ? scope.matchMedia : undefined;
}

/** matchMedia-backed source for the live browser; null where matchMedia is unavailable. */
export function createBrowserSource(): NarrowViewportSource | null {
  const matchMedia = getMatchMedia();
  if (!matchMedia) return null;

  const mediaQuery = matchMedia(NARROW_VIEWPORT_QUERY);
  const wrappers = new Map<
    (matches: boolean) => void,
    (event: MediaQueryListEvent) => void
  >();
  return {
    get matches() {
      return mediaQuery.matches;
    },
    addChangeListener(listener) {
      const wrapper = (event: MediaQueryListEvent) => listener(event.matches);
      wrappers.set(listener, wrapper);
      mediaQuery.addEventListener("change", wrapper);
    },
    removeChangeListener(listener) {
      const wrapper = wrappers.get(listener);
      if (!wrapper) return;
      wrappers.delete(listener);
      mediaQuery.removeEventListener("change", wrapper);
    },
  };
}

export function readNarrowViewport(source?: NarrowViewportSource): boolean {
  return (source ?? createBrowserSource())?.matches ?? false;
}

/** Event-driven subscription; returns the cleanup that detaches the listener. */
export function subscribeNarrowViewport(
  source: NarrowViewportSource,
  onNarrow: (narrow: boolean) => void,
): () => void {
  const handleChange = (matches: boolean) => onNarrow(matches);
  source.addChangeListener(handleChange);
  return () => {
    source.removeChangeListener(handleChange);
  };
}

export default function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => readNarrowViewport());

  useEffect(() => {
    const source = createBrowserSource();
    if (!source) return;
    return subscribeNarrowViewport(source, setNarrow);
  }, []);

  return narrow;
}
