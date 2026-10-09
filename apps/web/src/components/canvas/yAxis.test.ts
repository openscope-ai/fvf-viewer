import { describe, expect, it } from "vitest";
import {
  buildYAxisUnits,
  createYAxisAdapter,
  formatScaledTick,
  selectYUnit,
} from "./yAxis";

describe("YAxis SI unit selection and formatting (Issue #86)", () => {
  describe("buildYAxisUnits", () => {
    it("builds prefixable SI units for Voltage (default)", () => {
      const units = buildYAxisUnits("Voltage", "V");
      expect(units.map((u) => u.key)).toEqual(["kV", "V", "mV", "µV"]);
      expect(units.map((u) => u.factor)).toEqual([1e3, 1, 1e-3, 1e-6]);
      expect(units.map((u) => u.label)).toEqual([
        "Voltage (kV)",
        "Voltage (V)",
        "Voltage (mV)",
        "Voltage (µV)",
      ]);
    });

    it("supports extensible quantity and unit pairs (e.g. Current A)", () => {
      const units = buildYAxisUnits("Current", "A");
      expect(units.map((u) => u.key)).toEqual(["kA", "A", "mA", "µA"]);
      expect(units.map((u) => u.factor)).toEqual([1e3, 1, 1e-3, 1e-6]);
      expect(units.map((u) => u.label)).toEqual([
        "Current (kA)",
        "Current (A)",
        "Current (mA)",
        "Current (µA)",
      ]);
    });

    it("supports non-prefixable units such as %", () => {
      const units = buildYAxisUnits("Duty Cycle", "%");
      expect(units).toHaveLength(1);
      expect(units[0]).toEqual({
        key: "%",
        factor: 1,
        label: "Duty Cycle (%)",
      });
    });

    it("handles empty unit symbol gracefully", () => {
      const units = buildYAxisUnits("Ratio", "");
      expect(units).toHaveLength(1);
      expect(units[0]).toEqual({
        key: "Ratio",
        factor: 1,
        label: "Ratio",
      });
    });
  });

  describe("selectYUnit", () => {
    const units = buildYAxisUnits("Voltage", "V");
    const currentUnits = buildYAxisUnits("Current", "A");
    const dutyUnits = buildYAxisUnits("Duty Cycle", "%");

    it("AC1: selects A for ±665 A bound (665), not kA", () => {
      expect(selectYUnit(665, currentUnits).key).toBe("A");
      expect(selectYUnit(-665, currentUnits).key).toBe("A");
    });

    it("AC2: selects k-prefix for absolute bounds >= 1000", () => {
      expect(selectYUnit(1000, units).key).toBe("kV");
      expect(selectYUnit(1500, units).key).toBe("kV");
      expect(selectYUnit(5000, units).key).toBe("kV");
      expect(selectYUnit(-1500, units).key).toBe("kV");
    });

    it("AC2: selects base unit for absolute bounds in [1, 1000)", () => {
      expect(selectYUnit(999.9, units).key).toBe("V");
      expect(selectYUnit(1, units).key).toBe("V");
      expect(selectYUnit(10, units).key).toBe("V");
      expect(selectYUnit(-100, units).key).toBe("V");
    });

    it("AC2: selects m-prefix for absolute bounds in [1e-3, 1)", () => {
      expect(selectYUnit(0.999, units).key).toBe("mV");
      expect(selectYUnit(1e-3, units).key).toBe("mV");
      expect(selectYUnit(0.05, units).key).toBe("mV");
      expect(selectYUnit(-0.05, units).key).toBe("mV");
    });

    it("AC2: selects µ-prefix for absolute bounds in (0, 1e-3)", () => {
      expect(selectYUnit(0.000999, units).key).toBe("µV");
      expect(selectYUnit(1e-6, units).key).toBe("µV");
      expect(selectYUnit(1e-9, units).key).toBe("µV");
      expect(selectYUnit(-200e-6, units).key).toBe("µV");
    });

    it("AC2: non-prefixable units stay unscaled regardless of bound", () => {
      expect(selectYUnit(5000, dutyUnits).key).toBe("%");
      expect(selectYUnit(50, dutyUnits).key).toBe("%");
      expect(selectYUnit(0.001, dutyUnits).key).toBe("%");
      expect(selectYUnit(0, dutyUnits).key).toBe("%");
    });

    it("AC3: falls back to unscaled base unit for bound <= 0 or non-finite (never µV)", () => {
      expect(selectYUnit(0, units).key).toBe("V");
      expect(selectYUnit(-0, units).key).toBe("V");
      expect(selectYUnit(Number.NaN, units).key).toBe("V");
      expect(selectYUnit(Number.POSITIVE_INFINITY, units).key).toBe("V");
      expect(selectYUnit(Number.NEGATIVE_INFINITY, units).key).toBe("V");
    });
  });

  describe("formatScaledTick", () => {
    const units = buildYAxisUnits("Voltage", "V");
    const [kV, V, mV, uV] = units;

    it("formats Volts without jitter", () => {
      expect(formatScaledTick(0, V!)).toBe("0");
      expect(formatScaledTick(1.5, V!)).toBe("1.5");
      expect(formatScaledTick(-12, V!)).toBe("-12");
      expect(formatScaledTick(0.30000000000000004, V!)).toBe("0.3");
    });

    it("formats mV ticks scaled into active unit", () => {
      expect(formatScaledTick(0.025, mV!)).toBe("25");
      expect(formatScaledTick(-0.01, mV!)).toBe("-10");
      expect(formatScaledTick(0.0005, mV!)).toBe("0.5");
      expect(formatScaledTick(0, mV!)).toBe("0");
    });

    it("formats µV ticks scaled into active unit", () => {
      expect(formatScaledTick(12e-6, uV!)).toBe("12");
      expect(formatScaledTick(-50e-6, uV!)).toBe("-50");
      expect(formatScaledTick(0.5e-6, uV!)).toBe("0.5");
    });

    it("formats kV ticks scaled into active unit", () => {
      expect(formatScaledTick(2500, kV!)).toBe("2.5");
      expect(formatScaledTick(50000, kV!)).toBe("50");
      expect(formatScaledTick(-1000, kV!)).toBe("-1");
    });

    it("never produces -0 string", () => {
      expect(formatScaledTick(-0, V!)).toBe("0");
      expect(formatScaledTick(-0.0, V!)).toBe("0");
    });
  });

  describe("createYAxisAdapter", () => {
    it("defaults to Voltage (V) and establishes unit on first sync", () => {
      const adapter = createYAxisAdapter();
      expect(adapter.label).toBe("Voltage (V)");
      expect(adapter.unit.key).toBe("V");

      const axis = { scale: "y", label: adapter.label };
      adapter.sync({
        scales: { y: { min: -0.01, max: 0.01 } }, // 20 mV span
        axes: [undefined, axis],
      });

      expect(adapter.unit.key).toBe("mV");
      expect(adapter.label).toBe("Voltage (mV)");
      expect(axis.label).toBe("Voltage (mV)");
    });

    it("applies 5% hysteresis at boundaries to prevent flicker", () => {
      const adapter = createYAxisAdapter();
      const axis = { scale: "y", label: adapter.label };

      // Initial sync at 10V establishes V
      adapter.sync({
        scales: { y: { min: 0, max: 10 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("V");

      // Zoom in towards 1V boundary: span 0.98V (< 1.0 but >= 0.95 with 5% margin)
      adapter.sync({
        scales: { y: { min: 0, max: 0.98 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("V"); // Hysteresis prevents switch!

      // Zoom in past 0.95: span 0.94V -> switches to mV
      adapter.sync({
        scales: { y: { min: 0, max: 0.94 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("mV");
      expect(axis.label).toBe("Voltage (mV)");

      // Zoom out towards 1V boundary: span 1.02V (>= 1.0 but < 1.05 with 5% margin)
      adapter.sync({
        scales: { y: { min: 0, max: 1.02 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("mV"); // Hysteresis prevents switch back!

      // Zoom out past 1.05: span 1.06V -> switches back to V
      adapter.sync({
        scales: { y: { min: 0, max: 1.06 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("V");
      expect(axis.label).toBe("Voltage (V)");
    });

    it("applies hysteresis between V and kV", () => {
      const adapter = createYAxisAdapter();
      const axis = { scale: "y", label: adapter.label };

      // Establish in V at 500V span
      adapter.sync({
        scales: { y: { min: 0, max: 500 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("V");

      // Zoom out to 1020V (>= 1000 but < 1050)
      adapter.sync({
        scales: { y: { min: 0, max: 1020 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("V");

      // Zoom out to 1060V (>= 1050) -> switches to kV
      adapter.sync({
        scales: { y: { min: 0, max: 1060 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("kV");

      // Zoom in to 980V (< 1000 but >= 950)
      adapter.sync({
        scales: { y: { min: 0, max: 980 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("kV");

      // Zoom in to 940V (< 950) -> switches back to V
      adapter.sync({
        scales: { y: { min: 0, max: 940 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("V");
    });

    it("formats tick splits scaled according to the active unit", () => {
      const adapter = createYAxisAdapter();
      const axis = { scale: "y", label: adapter.label };

      // In V
      adapter.sync({
        scales: { y: { min: -5, max: 5 } },
        axes: [undefined, axis],
      });
      expect(adapter.values(null, [-5, 0, 5])).toEqual(["-5", "0", "5"]);

      // Zoom into mV
      adapter.sync({
        scales: { y: { min: -0.05, max: 0.05 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("mV");
      expect(adapter.values(null, [-0.025, 0, 0.025, 0.05])).toEqual([
        "-25",
        "0",
        "25",
        "50",
      ]);
    });

    it("supports seeding initialUnit to preserve established hysteresis state", () => {
      const adapter = createYAxisAdapter({ initialUnit: "V" });
      const axis = { scale: "y", label: adapter.label };
      expect(adapter.label).toBe("Voltage (V)");
      expect(adapter.unit.key).toBe("V");

      // Sync at 0.98V: since initialUnit was provided, established is true,
      // so hysteresis prevents switching to mV (requires < 0.95)
      adapter.sync({
        scales: { y: { min: 0, max: 0.98 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("V");
      expect(adapter.label).toBe("Voltage (V)");
    });

    it("supports non-prefixable units such as Duty Cycle %", () => {
      const adapter = createYAxisAdapter({ quantity: "Ratio", unit: "%" });
      const axis = { scale: "y", label: adapter.label };
      expect(adapter.label).toBe("Ratio (%)");

      adapter.sync({
        scales: { y: { min: 0, max: 100 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("%");
      expect(adapter.values(null, [0, 50, 100])).toEqual(["0", "50", "100"]);

      // Deep zoom does not change unit for non-prefixable
      adapter.sync({
        scales: { y: { min: 0, max: 0.01 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("%");
      expect(adapter.label).toBe("Ratio (%)");
    });

    it("AC1: renders an A axis (ticks <= 3 digits), not kA, for a ±665 A window", () => {
      const adapter = createYAxisAdapter({ quantity: "Current", unit: "A" });
      const axis = { scale: "y", label: adapter.label };
      adapter.sync({
        scales: { y: { min: -665, max: 665 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("A");
      expect(adapter.label).toBe("Current (A)");
      expect(axis.label).toBe("Current (A)");

      const ticks = adapter.values(null, [-600, -400, -200, 0, 200, 400, 600]);
      expect(ticks).toEqual(["-600", "-400", "-200", "0", "200", "400", "600"]);
      for (const tick of ticks) {
        if (tick == null) continue;
        const digits = tick.replace("-", "");
        expect(digits.length).toBeLessThanOrEqual(3);
      }
    });

    it("AC2: follows largest absolute bound for asymmetric windows", () => {
      const adapter = createYAxisAdapter({ quantity: "Voltage", unit: "V" });
      const axis = { scale: "y", label: adapter.label };

      // [-100, 1200]: maxAbs is 1200 >= 1000 -> kV
      adapter.sync({
        scales: { y: { min: -100, max: 1200 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("kV");
      expect(adapter.label).toBe("Voltage (kV)");

      // [-1200, 100]: maxAbs is 1200 >= 1000 -> kV
      adapter.sync({
        scales: { y: { min: -1200, max: 100 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("kV");

      // Zoom to [-665, 100]: maxAbs is 665 < 950 (hysteresis down from kV) -> V
      adapter.sync({
        scales: { y: { min: -665, max: 100 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("V");
      expect(adapter.label).toBe("Voltage (V)");
    });

    it("AC3: selects unscaled base unit for bound of 0 or non-finite (never µV)", () => {
      const adapter = createYAxisAdapter({ quantity: "Voltage", unit: "V" });
      const axis = { scale: "y", label: adapter.label };

      // Flatline at 0 V
      adapter.sync({
        scales: { y: { min: 0, max: 0 } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("V");
      expect(adapter.label).toBe("Voltage (V)");
      expect(axis.label).toBe("Voltage (V)");

      // Non-finite
      adapter.sync({
        scales: { y: { min: Number.NaN, max: Number.NaN } },
        axes: [undefined, axis],
      });
      expect(adapter.unit.key).toBe("V");
      expect(adapter.label).toBe("Voltage (V)");
    });
  });

  describe("per-channel scales (issue #106)", () => {
    it("keeps unknown tokens unscaled instead of inventing prefixed units", () => {
      const units = buildYAxisUnits("Input X", "arb");
      expect(units).toHaveLength(1);
      expect(units[0]).toEqual({
        key: "arb",
        factor: 1,
        label: "Input X (arb)",
      });
    });

    it("follows a per-channel scale key and labels its bound axis", () => {
      const adapter = createYAxisAdapter({
        quantity: "Input B",
        unit: "A",
        scaleKey: "y1",
      });
      expect(adapter.scaleKey).toBe("y1");
      const axis = { scale: "y1", label: "" };
      adapter.sync({
        scales: { y0: { min: -800, max: 800 }, y1: { min: -1, max: 1 } },
        axes: [undefined, axis],
      });
      // Span 2 in amperes selects the base unit, not the y0 span.
      expect(adapter.unit.key).toBe("A");
      expect(axis.label).toBe("Input B (A)");
      expect(adapter.values(null, [-1, 0.5, 1])).toEqual(["-1", "0.5", "1"]);
    });
  });

  describe("Stack-mode physical lane SI unit derivation (issue #270)", () => {
    it("AC2: signals under 1,000 V remain in [V] despite expanded multi-lane virtual bounds", () => {
      const adapter = createYAxisAdapter({
        quantity: "Voltage",
        unit: "V",
        scaleKey: "y0",
      });
      const axis = { scale: "y0", label: "" };
      // 4 lanes: a 300 V signal ([-150, 150]) gets virtual bounds [-1050, 150] (span 1200)
      // Virtual maxAbs is 1050 (> 1000 V), but physical span in lane is 300 V (< 1000 V).
      adapter.sync(
        {
          scales: { y0: { min: -1050, max: 150 } },
          axes: [undefined, axis],
        },
        0.25,
      );
      expect(adapter.unit.key).toBe("V");
      expect(adapter.label).toBe("Voltage (V)");
      expect(axis.label).toBe("Voltage (V)");
    });

    it("AC2: works with bandStart and bandFraction configuration", () => {
      const adapter = createYAxisAdapter({
        quantity: "Input A",
        unit: "V",
        scaleKey: "y0",
      });
      const axis = { scale: "y0", label: "" };
      // Lane 3 of 4: bandStart = 0.75, fraction = 0.25, virtual bounds [-150, 1050]
      adapter.sync(
        {
          scales: { y0: { min: -150, max: 1050 } },
          axes: [undefined, axis],
        },
        { bandStart: 0.75, laneFraction: 0.25 },
      );
      expect(adapter.unit.key).toBe("V");
      expect(adapter.label).toBe("Input A (V)");
    });

    it("AC2: zero-centered signal with 600 V amplitude (1200 V span) remains in [V] in Stack mode", () => {
      const adapter = createYAxisAdapter({
        quantity: "Voltage",
        unit: "V",
        scaleKey: "y0",
      });
      const axis = { scale: "y0", label: "" };
      // Base [-600, 600] in lane 0 of 4 -> virtual bounds [-4200, 600], physical amplitude 600 V
      adapter.sync(
        {
          scales: { y0: { min: -4200, max: 600 } },
          axes: [undefined, axis],
        },
        { bandStart: 0, laneFraction: 0.25 },
      );
      expect(adapter.unit.key).toBe("V");
      expect(adapter.label).toBe("Voltage (V)");
    });

    it("AC3: signals genuinely exceeding 1,000 V scale to [kV] in Stack mode", () => {
      const adapter = createYAxisAdapter({
        quantity: "Voltage",
        unit: "V",
        scaleKey: "y0",
      });
      const axis = { scale: "y0", label: "" };
      // 4 lanes: a 3,000 V signal gets virtual span 12,000 V (physical span 3,000 V >= 1,000 V)
      adapter.sync(
        {
          scales: { y0: { min: -10500, max: 1500 } },
          axes: [undefined, axis],
        },
        0.25,
      );
      expect(adapter.unit.key).toBe("kV");
      expect(adapter.label).toBe("Voltage (kV)");
      expect(axis.label).toBe("Voltage (kV)");
    });

    it("AC3: signals falling below 1 V scale to [mV] in Stack mode", () => {
      const adapter = createYAxisAdapter({
        quantity: "Voltage",
        unit: "V",
        scaleKey: "y0",
      });
      const axis = { scale: "y0", label: "" };
      // 4 lanes: a 200 mV signal gets virtual bounds [-0.7, 0.1] (span 0.8 V, physical 200 mV)
      adapter.sync(
        {
          scales: { y0: { min: -0.7, max: 0.1 } },
          axes: [undefined, axis],
        },
        0.25,
      );
      expect(adapter.unit.key).toBe("mV");
      expect(adapter.label).toBe("Voltage (mV)");
      expect(axis.label).toBe("Voltage (mV)");
    });

    it("AC3: obeys 5% hysteresis across boundaries in Stack mode", () => {
      const adapter = createYAxisAdapter({
        quantity: "Voltage",
        unit: "V",
        scaleKey: "y0",
      });
      const axis = { scale: "y0", label: "" };

      // Initial sync at 10 V physical span establishes V
      adapter.sync(
        {
          scales: { y0: { min: -35, max: 5 } }, // virtual span 40, physical 10 V
          axes: [undefined, axis],
        },
        0.25,
      );
      expect(adapter.unit.key).toBe("V");

      // Zoom in towards 1V: physical span 0.98 V (< 1.0 but >= 0.95 with 5% margin)
      adapter.sync(
        {
          scales: { y0: { min: -3.43, max: 0.49 } }, // virtual span 3.92, physical 0.98 V
          axes: [undefined, axis],
        },
        0.25,
      );
      expect(adapter.unit.key).toBe("V"); // Hysteresis prevents premature switch

      // Zoom in past 0.95: physical span 0.92 V -> switches to mV
      adapter.sync(
        {
          scales: { y0: { min: -3.22, max: 0.46 } }, // virtual span 3.68, physical 0.92 V
          axes: [undefined, axis],
        },
        0.25,
      );
      expect(adapter.unit.key).toBe("mV");
    });
  });
});
