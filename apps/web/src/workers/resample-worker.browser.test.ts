/**
 * Real-worker resampling IPC tests (issue #96, chromium via Playwright):
 * the RESAMPLE_TO_GRID wire path through the live Wasm engine — linear
 * interpolation onto a foreign grid, NaN outside the reference record,
 * and the detachment-guard copy contract (standalone Float32Array on the
 * main thread).
 */

import { describe, expect, it } from "vitest";
import { resampleToGrid } from "./workerClient";

describe("resample worker IPC (issue #96)", () => {
  it("resamples a differently-sampled reference onto the primary grid", async () => {
    // Reference at 10 Hz (0.1 s steps) onto a 20 Hz grid.
    const timestamps = Float32Array.from([0.0, 0.1, 0.2, 0.3, 0.4]);
    const values = Float32Array.from([0, 10, 20, 30, 40]);
    const grid = Float32Array.from([0.05, 0.15, 0.25, 0.35]);
    const out = await resampleToGrid(timestamps, values, grid);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.buffer).not.toBe(timestamps.buffer);
    expect([...out]).toEqual([5, 15, 25, 35]);
  });

  it("reads NaN for grid points outside the reference record", async () => {
    const timestamps = Float32Array.from([1.0, 2.0]);
    const values = Float32Array.from([4, 8]);
    const grid = Float32Array.from([0.0, 1.5, 3.0]);
    const out = await resampleToGrid(timestamps, values, grid);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeCloseTo(6, 6);
    expect(out[2]).toBeNaN();
  });

  it("handles large lanes in one worker session without detachment fallout", async () => {
    // 500k reference samples onto a 250k grid, then a second resample on
    // the same worker — the detachment guard must keep the engine alive.
    const n = 500_000;
    const timestamps = new Float32Array(n);
    const values = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      timestamps[i] = i * 0.5;
      values[i] = i;
    }
    const grid = new Float32Array(250_000);
    for (let i = 0; i < grid.length; i += 1) {
      grid[i] = i;
    }
    const first = await resampleToGrid(timestamps, values, grid);
    expect(first.length).toBe(grid.length);
    expect(first[1000]).toBeCloseTo(2000, 4);

    const second = await resampleToGrid(
      Float32Array.from([0, 1]),
      Float32Array.from([0, 1]),
      Float32Array.from([0.5]),
    );
    expect(second[0]).toBeCloseTo(0.5, 6);
  });
});
