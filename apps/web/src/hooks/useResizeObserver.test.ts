import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useResizeObserver, type Size } from "./useResizeObserver";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useResizeObserver (browser)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    hostElement = document.createElement("div");
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    hostElement.remove();
  });

  it("measures container dimensions and responds to size changes via RAF", async () => {
    let latestSize: Size = { width: 0, height: 0 };
    let callbackSize: Size | null = null;
    let resizeCallbackCount = 0;

    function TestComponent({
      width,
      height,
    }: {
      width: number;
      height: number;
    }) {
      const { ref, size } = useResizeObserver<HTMLDivElement>({
        onResize: (s) => {
          callbackSize = s;
          resizeCallbackCount += 1;
        },
      });

      useEffect(() => {
        latestSize = size;
      }, [size]);

      return React.createElement("div", {
        ref,
        "data-testid": "target",
        style: { width: `${width}px`, height: `${height}px`, display: "block" },
      });
    }

    await act(async () => {
      root.render(
        React.createElement(TestComponent, { width: 300, height: 200 }),
      );
    });

    // Wait for ResizeObserver callback and RAF dispatch within act
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(latestSize.width).toBe(300);
    expect(latestSize.height).toBe(200);
    expect(callbackSize).toEqual({ width: 300, height: 200 });
    expect(resizeCallbackCount).toBeGreaterThanOrEqual(1);

    // Update target dimensions to trigger resize event
    const countBeforeResize = resizeCallbackCount;
    await act(async () => {
      root.render(
        React.createElement(TestComponent, { width: 500, height: 400 }),
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(latestSize.width).toBe(500);
    expect(latestSize.height).toBe(400);
    expect(callbackSize).toEqual({ width: 500, height: 400 });
    expect(resizeCallbackCount).toBeGreaterThan(countBeforeResize);
  });

  it("does not fire onResize if element dimensions remain unchanged", async () => {
    let resizeCallbackCount = 0;

    function TestComponent({ tick }: { tick: number }) {
      const { ref } = useResizeObserver<HTMLDivElement>({
        onResize: () => {
          resizeCallbackCount += 1;
        },
      });

      return React.createElement("div", {
        ref,
        "data-tick": tick,
        style: { width: "250px", height: "150px", display: "block" },
      });
    }

    await act(async () => {
      root.render(React.createElement(TestComponent, { tick: 1 }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    const settledCount = resizeCallbackCount;
    expect(settledCount).toBeGreaterThanOrEqual(1);

    // Re-render with same dimensions
    await act(async () => {
      root.render(React.createElement(TestComponent, { tick: 2 }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    // Callback count should not increase because width/height did not change
    expect(resizeCallbackCount).toBe(settledCount);
  });
});
