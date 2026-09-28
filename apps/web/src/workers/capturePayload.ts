/**
 * Payload assembly (architecture.md 3.2, wasm-heap detachment guard):
 * copies every decoded sample vector out of Wasm linear memory into
 * standalone JS-allocated `Float32Array`s. The copies — never the
 * Wasm-aliasing views — are what enters the `postMessage` transfer list.
 */

import type { ParseResult } from "@fvf/fvf-wasm";
import type {
  CaptureMetadata,
  ChannelInfo,
  DerivedChannelView,
  DescriptorFlavor,
  ParsedCapture,
  ParseWarningCode,
  ParseWarningPayload,
  WaveformChannel,
} from "../types/capture";

export interface AssembledCapture {
  capture: ParsedCapture;
  /** Transferable buffers of `capture` (each listed exactly once). */
  transfer: ArrayBuffer[];
}

const range = (length: number): number[] =>
  Array.from({ length }, (_, index) => index);

function copySeries(
  memory: WebAssembly.Memory,
  ptr: number,
  len: number,
): Float32Array {
  if (len === 0) return new Float32Array(0);
  // View aliasing Wasm linear memory — copied immediately below and never
  // exposed further (transferring this buffer would detach the whole Wasm
  // heap and kill every subsequent parse).
  const view = new Float32Array(memory.buffer, ptr, len);
  return new Float32Array(view);
}

function copyRawCounts(
  memory: WebAssembly.Memory,
  ptr: number,
  len: number,
): Int32Array {
  if (len === 0) return new Int32Array(0);
  // Same detachment guard as copySeries, over the `i32` raw-count lane.
  const view = new Int32Array(memory.buffer, ptr, len);
  return new Int32Array(view);
}

/**
 * Ordering contract: every `Float32Array` view is created and fully
 * copied before any string-returning `ParseResult` accessor runs —
 * string getters allocate inside Wasm and may grow linear memory, which
 * detaches all previously created views.
 */
export function assembleCapture(
  memory: WebAssembly.Memory,
  result: ParseResult,
): AssembledCapture {
  const channelCount = result.channel_count;
  const derivedCount = result.derived_count;

  // Phase 1 — copies only (numeric accessors never allocate in Wasm).
  const physicalCopies = range(channelCount).map((index) => ({
    timestamps: copySeries(
      memory,
      result.channel_timestamps_ptr(index),
      result.channel_timestamps_len(index),
    ),
    data: copySeries(
      memory,
      result.channel_values_ptr(index),
      result.channel_values_len(index),
    ),
    rawCounts: copyRawCounts(
      memory,
      result.channel_raw_counts_ptr(index),
      result.channel_raw_counts_len(index),
    ),
  }));
  const derivedCopies = range(derivedCount).map((index) => ({
    data: copySeries(
      memory,
      result.derived_values_ptr(index),
      result.derived_values_len(index),
    ),
    rawCounts: copyRawCounts(
      memory,
      result.derived_raw_counts_ptr(index),
      result.derived_raw_counts_len(index),
    ),
  }));

  // Phase 2 — strings and scalars (allocation-safe: no views remain).
  const physical: WaveformChannel[] = physicalCopies.map((copy, index) => ({
    name: result.channel_letter(index),
    label: result.channel_label(index),
    derived: false,
    data: copy.data,
    rawCounts: copy.rawCounts,
  }));
  const derivedChannels: DerivedChannelView[] = derivedCopies.map(
    (copy, index) => {
      const samplesKnown = result.derived_samples_known(index);
      return {
        label: result.derived_label(index),
        recordLabel: result.derived_record_label(index),
        sourceChannels: result.derived_source_channels(index).split(""),
        samples: samplesKnown ? result.derived_samples(index) : undefined,
        deltaT: result.derived_delta_t_known(index)
          ? result.derived_delta_t(index)
          : undefined,
        data: copy.data,
        rawCounts: copy.rawCounts,
      };
    },
  );

  const channelInfo: ChannelInfo[] = [
    ...physical.map((channel, index) => ({
      name: channel.name,
      label: channel.label,
      derived: false,
      samples: result.channel_samples(index),
      deltaT: result.channel_delta_t(index),
      // Phase 2 ordering holds (string + scalar, no live views).
      unit: result.channel_unit(index),
      perDiv: result.channel_per_div(index),
      windowMin: result.channel_window_min(index),
      windowMax: result.channel_window_max(index),
      saturatedSamples: result.channel_saturated_samples(index),
    })),
    ...derivedChannels.map((channel, index) => ({
      name: channel.label,
      label: channel.label,
      derived: true,
      samples: channel.samples ?? 0,
      deltaT: channel.deltaT ?? 0,
      saturatedSamples: result.derived_saturated_samples(index),
    })),
  ];

  const warnings: ParseWarningPayload[] = range(result.warning_count).map(
    (index) => ({
      code: result.warning_code(index) as ParseWarningCode,
      message: result.warning_message(index),
    }),
  );

  const firstPhysical = channelInfo.find((channel) => !channel.derived);
  const metadata: CaptureMetadata = {
    version: result.version,
    flavor: result.flavor as DescriptorFlavor,
    timebaseRaw: result.timebase_raw,
    secondsPerDiv: result.seconds_per_div,
    timestamp14: result.timestamp14,
    samples: firstPhysical?.samples ?? 0,
    deltaT: firstPhysical?.deltaT ?? 0,
    channels: channelInfo,
  };

  const timestamps = physicalCopies[0]?.timestamps ?? new Float32Array(0);
  const capture: ParsedCapture = {
    timestamps,
    channels: physical,
    derivedChannels,
    warnings,
    metadata,
  };

  // `rawCounts` is optional on the shared channel types (hand-built
  // test fixtures omit it) but always present on worker payloads.
  const rawBuffers = [
    ...physical.map((channel) => channel.rawCounts),
    ...derivedChannels.map((channel) => channel.rawCounts),
  ].filter((counts): counts is Int32Array => counts !== undefined);
  const transfer = [
    timestamps,
    ...physical.map((channel) => channel.data),
    ...derivedChannels.map((channel) => channel.data),
    ...rawBuffers,
  ]
    .map((series) => series.buffer as ArrayBuffer)
    .filter((buffer, index, all) => all.indexOf(buffer) === index);

  return { capture, transfer };
}
