import { useCallback, useEffect, useRef } from "react";
import init, { engine_version } from "@fvf/fvf-wasm";
import Oscilloscope from "./components/canvas/Oscilloscope";
import WaveformToolbar from "./components/toolbar/WaveformToolbar";
import MetadataBanner from "./components/banner/MetadataBanner";
import FileIngestion from "./components/ingestion/FileIngestion";
import ErrorModal from "./components/modals/ErrorModal";
import DesktopRoadblock from "./components/guards/DesktopRoadblock";
import SiteFooter from "./components/footer/SiteFooter";
import {
  captureFileKey,
  useChannelNamesStore,
} from "./state/channelNamesStore";
import useNarrowViewport from "./hooks/useNarrowViewport";
import { useDocumentTitle } from "./hooks/useDocumentTitle";
import { useCaptureStore } from "./state/captureStore";
import { useReferenceStore } from "./state/referenceStore";
import { useCursorStore } from "./state/cursorStore";
import { useViewportStore } from "./state/viewportStore";
import { useChannelDisplayStore } from "./state/channelDisplayStore";

export default function App() {
  const capture = useCaptureStore((state) => state.capture);
  const error = useCaptureStore((state) => state.error);
  const fileName = useCaptureStore((state) => state.fileName);
  const reset = useCaptureStore((state) => state.reset);
  const openPickerRef = useRef<(() => void) | null>(null);
  const openComparePickerRef = useRef<(() => void) | null>(null);
  // Issue #96: the File 2 comparison slot (rendered state only — the
  // reference's own parse errors surface through the modal below).
  const referenceError = useReferenceStore((state) => state.error);
  const clearReferenceError = useReferenceStore((state) => state.clearError);

  // Issue #208: the banner brand lockup is the app's back-to-landing
  // affordance. Discarding the capture is intentionally immediate (no
  // confirmation step — a new capture is two clicks away); the loaded
  // capture's view state (viewport, cursors) resets with it.
  const returnToLanding = useCallback(() => {
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    // Issue #224: the solo quick-knob state resets with the loaded
    // capture's other view state.
    useChannelDisplayStore.getState().clearSolo();
    // Issue #96: discarding the capture discards the comparison too.
    useReferenceStore.getState().clear();
    reset();
  }, [reset]);
  const narrowViewport = useNarrowViewport();
  useDocumentTitle();

  useEffect(() => {
    let cancelled = false;

    init()
      .then(() => {
        if (!cancelled) {
          console.info(`[fvf-wasm] engine ready (v${engine_version()})`);
        }
      })
      .catch((err: unknown) => {
        console.error("[fvf-wasm] engine failed to initialise", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Issue #64: per-file channel-name persistence keyed by capture identity.
  const setChannelNamesFileKey = useChannelNamesStore(
    (state) => state.setFileKey,
  );
  useEffect(() => {
    setChannelNamesFileKey(
      captureFileKey(fileName, capture?.metadata.timestamp14),
    );
  }, [fileName, capture, setChannelNamesFileKey]);

  // Issue #96: replacing File 1 drops the File 2 comparison (its resampled
  // lanes belong to the old primary time grid) and clears solo with it.
  useEffect(() => {
    useReferenceStore.getState().clear();
    useChannelDisplayStore.getState().clearSolo();
  }, [capture]);

  return (
    <div className="app-frame">
      <main
        className="shell"
        aria-label="FVF Viewer workspace"
        inert={narrowViewport}
        tabIndex={-1}
      >
        <FileIngestion
          onOpenFileRef={openPickerRef}
          onOpenCompareRef={openComparePickerRef}
        >
          {capture ? (
            <>
              <MetadataBanner
                capture={capture}
                fileName={fileName}
                onOpenFile={() => openPickerRef.current?.()}
                onCompareFile={() => openComparePickerRef.current?.()}
                onReturnToLanding={returnToLanding}
              />
              <WaveformToolbar />
              <Oscilloscope capture={capture} />
            </>
          ) : null}
        </FileIngestion>
        {error ? <ErrorModal error={error} onDismiss={reset} /> : null}
        {referenceError ? (
          <ErrorModal error={referenceError} onDismiss={clearReferenceError} />
        ) : null}
      </main>
      <SiteFooter />
      {narrowViewport ? <DesktopRoadblock /> : null}
    </div>
  );
}
