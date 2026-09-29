/**
 * Counter-based drag-and-drop target hook (issue #11): tracks dragenter/dragleave
 * transitions accurately over nested DOM hierarchies without flickering, exposing
 * an active drag indicator and event handlers.
 */

import { useCallback, useRef, useState } from "react";

export interface UseDropTargetOptions {
  onDrop: (files: FileList | null) => void;
  enabled?: boolean;
}

export function useDropTarget({
  onDrop,
  enabled = true,
}: UseDropTargetOptions) {
  const [isDragActive, setIsDragActive] = useState(false);
  const dragCounter = useRef(0);

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
      dragCounter.current = 0;
      setIsDragActive(false);
      onDrop(event.dataTransfer.files);
    },
    [enabled, onDrop],
  );

  const reset = useCallback(() => {
    dragCounter.current = 0;
    setIsDragActive(false);
  }, []);

  return {
    isDragActive,
    reset,
    dropTargetProps: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop: handleDrop,
    },
  };
}
