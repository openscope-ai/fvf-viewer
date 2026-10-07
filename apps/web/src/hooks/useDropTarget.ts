/**
 * Counter-based drag-and-drop target hook (issue #11): tracks dragenter/dragleave
 * transitions accurately over nested DOM hierarchies without flickering, exposing
 * an active drag indicator and event handlers.
 */

import { useCallback, useRef, useState } from "react";

/** Which half of the split overlay the dragged file currently sits over. */
export type DropHalf = "left" | "right";

export interface UseDropTargetOptions {
  /**
   * Issue #96: the drop handler learns which half of the split overlay
   * the file was released over (left = replace, right = compare).
   */
  onDrop: (files: FileList | null, half?: DropHalf) => void;
  enabled?: boolean;
}

export function useDropTarget({
  onDrop,
  enabled = true,
}: UseDropTargetOptions) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [dropHalf, setDropHalf] = useState<DropHalf | null>(null);
  const dragCounter = useRef(0);
  // The container element and the pointer's current half are tracked in
  // refs: dragover fires continuously ahead of the drop, so the release
  // position is already known when the drop lands (and no geometry is
  // read off the synthetic event inside the drop handler).
  const containerRef = useRef<HTMLElement | null>(null);
  const dropHalfRef = useRef<DropHalf | null>(null);

  const onDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (!enabled) return;
      event.preventDefault();
      dragCounter.current += 1;
      if (dragCounter.current === 1) {
        setIsDragActive(true);
      }
    },
    [enabled],
  );

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!enabled) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      // Issue #96: the split drop overlay routes by pointer position —
      // dragover fires continuously, so the latest clientX wins.
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const half =
        event.clientX - rect.left < rect.width / 2 ? "left" : "right";
      dropHalfRef.current = half;
      setDropHalf(half);
    },
    [enabled],
  );

  const onDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (!enabled) return;
      event.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsDragActive(false);
      }
    },
    [enabled],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      if (!enabled) return;
      event.preventDefault();
      // The half tracked by the preceding dragover stream decides the
      // routing (left = replace when no dragover was seen, right =
      // compare); synthetic dispatches without coordinates behave like
      // the historical replace-only drop.
      const half = dropHalfRef.current ?? "left";
      dragCounter.current = 0;
      setIsDragActive(false);
      dropHalfRef.current = null;
      setDropHalf(null);
      onDrop(event.dataTransfer.files, half);
    },
    [enabled, onDrop],
  );

  const reset = useCallback(() => {
    dragCounter.current = 0;
    setIsDragActive(false);
    dropHalfRef.current = null;
    setDropHalf(null);
  }, []);

  return {
    isDragActive,
    dropHalf,
    reset,
    dropTargetProps: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop: handleDrop,
      ref: (element: HTMLElement | null) => {
        containerRef.current = element;
      },
    },
  };
}
