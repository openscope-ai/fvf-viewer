/**
 * Live PNG snapshot assembly & exporter factory (issues #18, #252, #333, #355):
 * moved out of `Oscilloscope.tsx` so the canvas component drops all
 * `pngSnapshot` / `readoutSnapshot` imports and only exposes its live uPlot
 * handle, capture ref, and container element.
 *
 * Reads the current Zustand stores once per export invocation and passes a
 * frozen `PrintRenderContext` into `composePrintSnapshot`, keeping
 * `pngSnapshot.ts` completely free of global store reads.
 */

import type uPlot from "uplot";
import type { ParsedCapture } from "../../types/capture";
import type { PngExportSettings } from "../../state/pngExportStore";
import { getChannelCatalog } from "../../capture/channelCatalog";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useCursorDisplayStore } from "../../state/cursorDisplayStore";
import { useCursorStore } from "../../state/cursorStore";
import { useLaneLayoutStore } from "../../state/laneLayoutStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useReadoutCardStore } from "../../state/readoutCardStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useViewportStore } from "../../state/viewportStore";
import {
  effectiveCursorColor,
  effectiveCursorStroke,
  effectiveTraceColor,
  resolveThemePalette,
} from "../canvas/themePalette";
import {
  buildReadoutRows,
  type ReadoutCardSnapshot,
} from "../cursors/readoutSnapshot";
import {
  composePrintSnapshot,
  composeSnapshotCanvas,
  snapshotToBlob,
  type PrintRenderContext,
  type PrintSeriesSpec,
} from "./pngSnapshot";

export interface SnapshotExporterHost {
  getUplot: () => uPlot | null;
  getCapture: () => ParsedCapture | null;
  getContainer: () => HTMLElement | null;
}

/**
 * Captures a frozen `PrintRenderContext` from the live Zustand stores for
 * `composePrintSnapshot` (used by both the production exporter and browser
 * tests exercising `composePrintSnapshot` directly).
 */
export function buildPrintRenderContext(
  capture: ParsedCapture,
  series: readonly PrintSeriesSpec[],
  palette: "light" | "dark" = "light",
): PrintRenderContext {
  const refState = useReferenceStore.getState();
  const refLanes = refState.lanes ?? [];
  const trailingSeriesCount = Math.max(
    refLanes.length,
    Math.max(0, series.length - capture.channels.length),
  );
  const catalog = getChannelCatalog(capture, {
    referenceLaneCount: trailingSeriesCount,
  });
  const displayState = useChannelDisplayStore.getState();
  const laneWeights = useLaneLayoutStore.getState().weights;
  const customColors = usePaletteStore.getState().customColors;
  const t2 =
    refState.capture && refState.lanes
      ? {
          timeSlipSamples: refState.timeSlipSamples,
          accentColor:
            series[capture.channels.length]?.color ??
            effectiveTraceColor(palette, customColors, "Ref-A"),
        }
      : null;

  return {
    catalog,
    stackMode: displayState.stackMode,
    laneWeights,
    displayConfigs: displayState.keyConfigs,
    refLanes,
    t2,
  };
}

/**
 * Builds the `useSnapshotStore` exporter callback bound to the live canvas
 * host refs.
 */
export function createSnapshotExporter(
  host: SnapshotExporterHost,
): (settings: PngExportSettings) => Promise<Blob> {
  return async (settings: PngExportSettings): Promise<Blob> => {
    const live = host.getUplot();
    const liveCapture = host.getCapture();
    const container = host.getContainer();
    if (!live || !liveCapture) {
      throw new Error("no capture loaded for PNG snapshot");
    }

    const colorsNow = usePaletteStore.getState().customColors;
    const configsNow = usePaletteStore.getState().keyConfigs;
    const cursorState = useCursorStore.getState();
    const viewportState = useViewportStore.getState();
    const renderTheme = settings.theme === "light" ? "light" : "dark";
    const customNames = useChannelNamesStore.getState().names;
    const refState = useReferenceStore.getState();

    const snapshotCatalog = getChannelCatalog(liveCapture, {
      referenceLaneCount: refState.capture?.channels.length ?? 0,
    });
    const legend = snapshotCatalog.channels
      .filter((ch) => ch.visible)
      .map((ch) => ({
        label: ch.displayName,
        color: effectiveTraceColor(renderTheme, colorsNow, ch.id),
      }));

    const displayNow = useCursorDisplayStore.getState();
    const overlay = {
      cursor1: effectiveCursorStroke(renderTheme, colorsNow, configsNow, "C1"),
      cursor2: effectiveCursorStroke(renderTheme, colorsNow, configsNow, "C2"),
      lineStyles: displayNow.lineStyles,
      background: resolveThemePalette(renderTheme).background,
      legend,
      selected: cursorState.selectedCursor,
      selectedRingColor: renderTheme === "light" ? "#333333" : "#ffffff",
    };

    const cursorSnapshot = settings.cursors
      ? {
          cursor: {
            c1Active: cursorState.c1Active,
            c1SampleIndex: cursorState.c1SampleIndex,
            c2Active: cursorState.c2Active,
            c2SampleIndex: cursorState.c2SampleIndex,
          },
        }
      : {
          cursor: {
            c1Active: false,
            c1SampleIndex: cursorState.c1SampleIndex,
            c2Active: false,
            c2SampleIndex: cursorState.c2SampleIndex,
          },
        };

    let readoutCard: ReadoutCardSnapshot | null = null;
    const cardEl = container?.parentElement?.querySelector(
      "[data-testid='cursor-readout-card']",
    );
    if (cardEl instanceof HTMLElement && container) {
      const cardRect = cardEl.getBoundingClientRect();
      const canvasRect = container.getBoundingClientRect();
      const effectiveXMin =
        viewportState.xMin ?? liveCapture.timestamps[0] ?? 0;
      const effectiveXMax =
        viewportState.xMax ??
        liveCapture.timestamps[liveCapture.timestamps.length - 1] ??
        1;
      readoutCard = {
        x: cardRect.left - canvasRect.left,
        y: cardRect.top - canvasRect.top,
        width: cardRect.width,
        height: cardRect.height,
        collapsed:
          settings.readoutCard === "collapsed" ||
          (settings.readoutCard === "full" &&
            useReadoutCardStore.getState().collapsed),
        rows: buildReadoutRows(
          liveCapture,
          cursorState,
          viewportState.activeChannels,
          effectiveXMin,
          effectiveXMax,
          {
            c1: effectiveCursorColor(renderTheme, colorsNow, "C1"),
            c2: effectiveCursorColor(renderTheme, colorsNow, "C2"),
            channel: (name: string) =>
              effectiveTraceColor(renderTheme, colorsNow, name),
          },
          customNames,
          {
            time: displayNow.timeUnit,
            frequency: displayNow.frequencyUnit,
            voltage: displayNow.voltageUnit,
          },
          {
            c1Binding: displayNow.bindings.C1,
            c2Binding: displayNow.bindings.C2,
            deltaLocked: displayNow.deltaLocked,
          },
        ),
      };
    }
    if (settings.readoutCard === "excluded") {
      readoutCard = null;
    }

    const screenPath =
      renderTheme === "dark" &&
      settings.background === "opaque" &&
      settings.grid;
    if (screenPath) {
      const composite = composeSnapshotCanvas(live, liveCapture, overlay, {
        ...cursorSnapshot,
        readoutCard,
      });
      return snapshotToBlob(composite.canvas);
    }

    const printSeries: PrintSeriesSpec[] = snapshotCatalog.channels.map(
      (ch) => ({
        label: ch.displayName,
        color: effectiveTraceColor(renderTheme, colorsNow, ch.id),
        show: live.series[ch.seriesIdx]?.show ?? ch.visible,
      }),
    );
    const renderContext = buildPrintRenderContext(
      liveCapture,
      printSeries,
      renderTheme,
    );
    const printComposite = await composePrintSnapshot(
      live,
      liveCapture,
      overlay,
      {
        ...cursorSnapshot,
        readoutCard,
        series: printSeries,
        palette: renderTheme,
        transparent: settings.background === "transparent",
        omitGrid: !settings.grid,
        renderContext,
      },
    );
    return snapshotToBlob(printComposite.canvas);
  };
}
