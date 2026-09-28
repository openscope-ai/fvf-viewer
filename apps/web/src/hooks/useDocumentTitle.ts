/**
 * Dynamic browser tab title (issues #74, #101, #142): while a capture is
 * active the title is `<filename> - FVF Viewer` (filename leftmost, full file
 * extension kept) so crowded browser tabs stay distinguishable; the title
 * reverts to the default brand title `fvf • viewer` whenever no capture is
 * loaded — initial landing state, after reset(), or on a parse failure (the
 * store nulls the capture).
 */

import { useEffect } from "react";
import { useCaptureStore } from "../state/captureStore";

export const DEFAULT_DOCUMENT_TITLE = "fvf • viewer";

export function documentTitleFor(
  fileName: string | null,
  hasCapture: boolean,
): string {
  return hasCapture && fileName
    ? `${fileName} - FVF Viewer`
    : DEFAULT_DOCUMENT_TITLE;
}

export function useDocumentTitle(): void {
  const fileName = useCaptureStore((state) => state.fileName);
  const capture = useCaptureStore((state) => state.capture);

  useEffect(() => {
    document.title = documentTitleFor(fileName, capture !== null);
  }, [fileName, capture]);
}
