/**
 * Physical display-lane cache (issue #238): `buildDisplayData` (the
 * O(N) rail-clipping pass over raw counts) used to run for EVERY
 * channel on EVERY display-transform commit — per pointer event during
 * scrub drags — which made the popover fields feel sluggish. The
 * rail-clipped physical lane depends only on the capture buffers, so it
 * is computed once per (capture, channel) and reused; display
 * transforms (scale/offset/invert) then compose on top as a cheap
 * affine pass.
 *
 * Weak-keyed by the ParsedCapture object: ingesting or replacing a
 * capture drops the whole entry with the object, no invalidation
 * bookkeeping, and the physical capture buffers themselves are never
 * mutated (readouts keep reading truth).
 */

import { buildDisplayData } from "../../capture/channelUnits";
import type { ParsedCapture } from "../../types/capture";

const cache = new WeakMap<ParsedCapture, (Float32Array | undefined)[]>();

/**
 * The rail-clipped physical display lane for one channel, computed on
 * first use and cached per capture. Derived channels rail-clip with
 * undefined windows exactly like the previous inline call sites.
 */
export function physicalDisplayLane(
  capture: ParsedCapture,
  index: number,
): Float32Array {
  let lanes = cache.get(capture);
  if (!lanes) {
    lanes = [];
    cache.set(capture, lanes);
  }
  let lane = lanes[index];
  if (!lane) {
    const channel = capture.channels[index];
    if (!channel) {
      throw new RangeError(`physicalDisplayLane: no channel at ${index}`);
    }
    const info = capture.metadata.channels[index];
    const physical = info && !info.derived ? info : undefined;
    lane = buildDisplayData(
      channel.data,
      channel.rawCounts,
      physical?.windowMin,
      physical?.windowMax,
    );
    lanes[index] = lane;
  }
  return lane;
}
