import { useEffect, useRef } from "react";
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

export default function App() {
  const capture = useCaptureStore((state) => state.capture);
  const error = useCaptureStore((state) => state.error);
  const fileName = useCaptureStore((state) => state.fileName);
  const reset = useCaptureStore((state) => state.reset);
  const openPickerRef = useRef<(() => void) | null>(null);
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

  return (
    <div className="app-frame">
      <main
        className="shell"
        aria-label="FVF Viewer workspace"
        inert={narrowViewport}
        tabIndex={-1}
      >
        <FileIngestion onOpenFileRef={openPickerRef}>
          {capture ? (
            <>
              <MetadataBanner
                capture={capture}
                fileName={fileName}
                onOpenFile={() => openPickerRef.current?.()}
              />
              <WaveformToolbar />
              <Oscilloscope capture={capture} />
            </>
          ) : null}
        </FileIngestion>
        {error ? <ErrorModal error={error} onDismiss={reset} /> : null}
      </main>
      <SiteFooter />
      {narrowViewport ? <DesktopRoadblock /> : null}
    </div>
  );
}
