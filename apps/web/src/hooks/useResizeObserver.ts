import { useEffect, useRef, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

export interface UseResizeObserverOptions {
  onResize?: (size: Size) => void;
  box?: ResizeObserverBoxOptions;
}

export interface UseResizeObserverResult<
  T extends HTMLElement = HTMLDivElement,
> {
  ref: React.RefObject<T | null>;
  width: number;
  height: number;
  size: Size;
}

/**
 * Responsive resize observer hook using ResizeObserver batched via
 * requestAnimationFrame for 60 FPS measurements without layout thrashing.
 */
export function useResizeObserver<T extends HTMLElement = HTMLDivElement>(
  options?: UseResizeObserverOptions,
  passedRef?: React.RefObject<T | null>,
): UseResizeObserverResult<T> {
  const localRef = useRef<T | null>(null);
  const ref = passedRef ?? localRef;
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  const onResizeRef = useRef(options?.onResize);
  onResizeRef.current = options?.onResize;

  const box = options?.box;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Measure initial layout dimensions if element is already in DOM
    const initialWidth = Math.round(
      element.clientWidth || element.getBoundingClientRect().width || 0,
    );
    const initialHeight = Math.round(
      element.clientHeight || element.getBoundingClientRect().height || 0,
    );
    if (initialWidth > 0 || initialHeight > 0) {
      const initialSize = { width: initialWidth, height: initialHeight };
      setSize(initialSize);
      onResizeRef.current?.(initialSize);
    }

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    let rafId: number | null = null;

    const scheduleRaf = (cb: () => void): number => {
      return typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(cb)
        : (setTimeout(cb, 16) as unknown as number);
    };

    const cancelRaf = (id: number): void => {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(id);
      } else {
        clearTimeout(id);
      }
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      if (rafId !== null) {
        cancelRaf(rafId);
      }

      rafId = scheduleRaf(() => {
        let w = 0;
        let h = 0;

        if (entry.contentRect) {
          w = Math.round(entry.contentRect.width);
          h = Math.round(entry.contentRect.height);
        } else if (entry.borderBoxSize && entry.borderBoxSize.length > 0) {
          const firstBox = entry.borderBoxSize[0];
          if (firstBox) {
            w = Math.round(firstBox.inlineSize);
            h = Math.round(firstBox.blockSize);
          }
        }

        setSize((prev) => {
          if (prev.width === w && prev.height === h) {
            return prev;
          }
          const next = { width: w, height: h };
          onResizeRef.current?.(next);
          return next;
        });
      });
    });

    observer.observe(element, { box });

    return () => {
      if (rafId !== null) {
        cancelRaf(rafId);
      }
      observer.disconnect();
    };
  }, [ref, box]);

  return {
    ref,
    width: size.width,
    height: size.height,
    size,
  };
}
