import { afterEach, describe, expect, it, vi } from "vitest";
import useNarrowViewport, {
  createBrowserSource,
  NARROW_VIEWPORT_QUERY,
  readNarrowViewport,
  subscribeNarrowViewport,
  type NarrowViewportSource,
} from "./useNarrowViewport";

type ChangeListener = (matches: boolean) => void;

function createFakeSource(initialMatches: boolean): {
  source: NarrowViewportSource;
  setMatches: (matches: boolean) => void;
  listeners: Set<ChangeListener>;
} {
  const listeners = new Set<ChangeListener>();
  const state = { matches: initialMatches };
  const source: NarrowViewportSource = {
    get matches() {
      return state.matches;
    },
    addChangeListener(listener) {
      listeners.add(listener);
    },
    removeChangeListener(listener) {
      listeners.delete(listener);
    },
  };
  return {
    source,
    listeners,
    setMatches(matches: boolean) {
      state.matches = matches;
      for (const listener of [...listeners]) listener(matches);
    },
  };
}

describe("useNarrowViewport logic (node, stubbed matchMedia)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the initial narrow state from matchMedia.matches", () => {
    const narrow = createFakeSource(true);
    expect(readNarrowViewport(narrow.source)).toBe(true);

    const wide = createFakeSource(false);
    expect(readNarrowViewport(wide.source)).toBe(false);
  });

  it("uses the canonical (max-width: 1899px) media query against matchMedia", () => {
    const { source } = createFakeSource(false);
    const matchMedia = vi.fn(() => source);
    vi.stubGlobal("matchMedia", matchMedia);

    expect(readNarrowViewport()).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith(NARROW_VIEWPORT_QUERY);
    expect(NARROW_VIEWPORT_QUERY).toBe("(max-width: 1899px)");
  });

  it("reports a wide viewport when matchMedia is unavailable", () => {
    expect(readNarrowViewport()).toBe(false);
  });

  it("forwards matchMedia change toggles to the subscriber", () => {
    const { source, setMatches, listeners } = createFakeSource(false);
    const seen: boolean[] = [];
    subscribeNarrowViewport(source, (narrow) => seen.push(narrow));

    expect(listeners.size).toBe(1);
    setMatches(true);
    setMatches(false);
    expect(seen).toEqual([true, false]);
  });

  it("detaches the change listener on cleanup", () => {
    const { source, setMatches, listeners } = createFakeSource(false);
    const seen: boolean[] = [];
    const dispose = subscribeNarrowViewport(source, (narrow) =>
      seen.push(narrow),
    );

    dispose();
    expect(listeners.size).toBe(0);

    setMatches(true); // after cleanup nothing is forwarded
    expect(seen).toEqual([]);
  });

  it("createBrowserSource keeps per-listener semantics against real matchMedia shapes", () => {
    type Wrapped = (event: { matches: boolean }) => void;
    const registered = new Map<Wrapped, Wrapped>();
    const fakeMediaQuery = {
      matches: false,
      addEventListener: (_type: string, listener: Wrapped) => {
        registered.set(listener, listener);
      },
      removeEventListener: (_type: string, listener: Wrapped) => {
        registered.delete(listener);
      },
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => fakeMediaQuery),
    );

    const source = createBrowserSource();
    expect(source).not.toBeNull();
    if (!source) return;

    const seenA: boolean[] = [];
    const seenB: boolean[] = [];
    const listenerA = (narrow: boolean) => seenA.push(narrow);
    const listenerB = (narrow: boolean) => seenB.push(narrow);
    source.addChangeListener(listenerA);
    source.addChangeListener(listenerB);
    expect(registered.size).toBe(2); // one wrapped MediaQueryList listener each

    // Firing the wrapped listeners forwards event.matches per listener.
    for (const wrapper of [...registered.keys()]) wrapper({ matches: true });
    expect(seenA).toEqual([true]);
    expect(seenB).toEqual([true]);

    // Removing one listener detaches only its own wrapper (F2 regression).
    source.removeChangeListener(listenerA);
    expect(registered.size).toBe(1);
    for (const wrapper of [...registered.keys()]) wrapper({ matches: false });
    expect(seenA).toEqual([true]); // A detached: no further forwarding
    expect(seenB).toEqual([true, false]);

    source.removeChangeListener(listenerB);
    expect(registered.size).toBe(0);
  });
});

describe("useNarrowViewport hook (node render, stubbed matchMedia)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders from the initial matchMedia.matches value", async () => {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { source } = createFakeSource(true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => source),
    );

    function Component() {
      const narrow = useNarrowViewport();
      return React.createElement("div", null, String(narrow));
    }

    expect(renderToStaticMarkup(React.createElement(Component))).toBe(
      "<div>true</div>",
    );
  });

  it("renders wide when matchMedia is unavailable", async () => {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");

    function Component() {
      const narrow = useNarrowViewport();
      return React.createElement("div", null, String(narrow));
    }

    expect(renderToStaticMarkup(React.createElement(Component))).toBe(
      "<div>false</div>",
    );
  });
});
