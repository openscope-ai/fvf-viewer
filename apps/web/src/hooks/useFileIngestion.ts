/**
 * File ingestion hook (issue #11): extracts the primary file from drag drops
 * or the native file picker, reads its ArrayBuffer, and initiates the worker
 * parse round-trip via the Zustand captureStore.
 *
 * Rules per architecture.md and issue-11-context:
 * - Multi-file drops take the first file.
 * - No file-extension pre-filter (signature verification is the authority).
 * - Safe error handling (never throws unhandled exceptions).
 *
 * `ingestUrl` (issue #193) feeds the shipped sample capture through the
 * exact same ticket/parse/error pipeline: only the byte source (a
 * same-origin fetch instead of a user file) differs.
 */

import { useCallback, useRef } from "react";
import { useCaptureStore } from "../state/captureStore";

export function extractFirstFile(
  files: FileList | File[] | null | undefined,
): File | null {
  if (!files || files.length === 0) {
    return null;
  }
  return files[0] ?? null;
}

export function useFileIngestion() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ingestFiles = useCallback(
    async (files: FileList | File[] | null | undefined): Promise<void> => {
      const file = extractFirstFile(files);
      if (!file) {
        return;
      }
      // Allocate ticket from captureStore: immediately invalidates any
      // in-flight file read OR in-flight worker parse from an earlier selection,
      // transitioning the store to 'parsing' for this file.
      const ticket = useCaptureStore.getState().allocateTicket(file.name);
      try {
        const buffer = await file.arrayBuffer();
        if (ticket !== useCaptureStore.getState().currentTicket()) {
          return;
        }
        await useCaptureStore.getState().parseBuffer(buffer, file.name, ticket);
      } catch (error) {
        if (ticket === useCaptureStore.getState().currentTicket()) {
          useCaptureStore.getState().failIngestion(ticket, error, file.name);
        }
        console.error("[useFileIngestion] failed to read or parse file", error);
      }
    },
    [],
  );

  const ingestFile = useCallback(
    async (file: File): Promise<void> => {
      await ingestFiles([file]);
    },
    [ingestFiles],
  );

  const ingestUrl = useCallback(
    async (url: string, fileName: string): Promise<void> => {
      // Same ticket discipline as a picked file: the ticket invalidates any
      // in-flight selection, keeps the store in 'parsing' for this sample,
      // and routes fetch/read failures into the standard error modal path.
      const ticket = useCaptureStore.getState().allocateTicket(fileName);
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Sample request failed: HTTP ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        if (ticket !== useCaptureStore.getState().currentTicket()) {
          return;
        }
        await useCaptureStore.getState().parseBuffer(buffer, fileName, ticket);
      } catch (error) {
        if (ticket === useCaptureStore.getState().currentTicket()) {
          useCaptureStore.getState().failIngestion(ticket, error, fileName);
        }
        console.error(
          "[useFileIngestion] failed to fetch or parse sample",
          error,
        );
      }
    },
    [],
  );

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return {
    fileInputRef,
    ingestFiles,
    ingestFile,
    ingestUrl,
    openFileDialog,
  };
}
