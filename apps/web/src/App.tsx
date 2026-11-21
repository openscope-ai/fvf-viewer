import { useEffect, useRef } from "react";
import init, { engine_version } from "@fvf/fvf-wasm";
import Oscilloscope from "./components/canvas/Oscilloscope";
import WaveformToolbar from "./components/toolbar/WaveformToolbar";
import MetadataBanner from "./components/banner/MetadataBanner";
import MeasurementsTable from "./components/measurements/MeasurementsTable";
import FileIngestion from "./components/ingestion/FileIngestion";
import ErrorModal from "./components/modals/ErrorModal";
import DesktopRoadblock from "./components/guards/DesktopRoadblock";
import SiteFooter from "./components/footer/SiteFooter";
import useNarrowViewport from "./hooks/useNarrowViewport";
import { useDocumentTitle } from "./hooks/useDocumentTitle";
import { useCaptureStore } from "./state/captureStore";
import { useReferenceStore } from "./state/referenceStore";
import { returnToLanding } from "./state/captureSession";

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
              <Oscilloscope />
              <MeasurementsTable capture={capture} />
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
