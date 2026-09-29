import { describe, expect, it } from "vitest";
import { buildMetadataModel, formatCaptureTimestamp } from "./metadataModel";
import type { ParsedCapture } from "../../types/capture";

describe("metadataModel pure view-model builder", () => {
  describe("formatCaptureTimestamp", () => {
    it("converts 14-digit HHMMSSYYYYMMDD into 'YYYY-MM-DD HH:MM:SS'", () => {
      expect(formatCaptureTimestamp("12000020260101")).toBe(
        "2026-01-01 12:00:00",
      );
      expect(formatCaptureTimestamp("03015620100531")).toBe(
        "2010-05-31 03:01:56",
      );
      expect(formatCaptureTimestamp("14594020260803")).toBe(
        "2026-08-03 14:59:40",
      );
    });

    it("returns 'Not recorded' when timestamp is missing, empty, or invalid", () => {
      expect(formatCaptureTimestamp("")).toBe("Not recorded");
      expect(formatCaptureTimestamp(null)).toBe("Not recorded");
      expect(formatCaptureTimestamp(undefined)).toBe("Not recorded");
      expect(formatCaptureTimestamp("short")).toBe("Not recorded");
      expect(formatCaptureTimestamp("not14digitsstring")).toBe("Not recorded");
      expect(formatCaptureTimestamp("12000020261301")).toBe("Not recorded"); // month 13
      expect(formatCaptureTimestamp("12000020260001")).toBe("Not recorded"); // month 00
      expect(formatCaptureTimestamp("12000020260132")).toBe("Not recorded"); // day 32
      expect(formatCaptureTimestamp("25000020260101")).toBe("Not recorded"); // hour 25
      expect(formatCaptureTimestamp("12600020260101")).toBe("Not recorded"); // minute 60
    });
  });

  describe("buildMetadataModel", () => {
    it("handles uniform physical channel samples", () => {
      const mockCapture: ParsedCapture = {
        timestamps: new Float32Array(10000),
        channels: [
          {
            name: "A",
            label: "Input A",
            derived: false,
            data: new Float32Array(10000),
          },
          {
            name: "B",
            label: "Input B",
            derived: false,
            data: new Float32Array(10000),
          },
        ],
        derivedChannels: [],
        warnings: [],
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "10 ms/Div",
          secondsPerDiv: 0.01,
          timestamp14: "12000020260101",
          samples: 10000,
          deltaT: 1e-5,
          channels: [
            {
              name: "A",
              label: "Input A",
              derived: false,
              samples: 10000,
              deltaT: 1e-5,
            },
            {
              name: "B",
              label: "Input B",
              derived: false,
              samples: 10000,
              deltaT: 1e-5,
            },
          ],
        },
      };

      const model = buildMetadataModel(mockCapture, "sample.fvf");
      expect(model.fileName).toBe("sample.fvf");
      expect(model.captureDate).toBe("2026-01-01 12:00:00");
      expect(model.physicalChannelCount).toBe(2);
      expect(model.physicalChannelsLabel).toBe("2 channels");
      expect(model.isUniformSamples).toBe(true);
      expect(model.uniformSamplesCount).toBe(10000);
      expect(model.samplesPerChannelText).toBe("10,000 samples");
      expect(model.timebaseRaw).toBe("10 ms/Div");
      expect(model.triggerReferenceValue).toBe("0 s");
      expect(model.triggerReferenceLabel).toBe("0 s");
      expect(model.triggerReferenceTooltip).toContain(
        "t = 0 marks the acquisition trigger reference",
      );
      expect(model.derivedChannels).toHaveLength(0);
    });

    it("handles differing per-channel samples across physical channels", () => {
      const mockCapture: ParsedCapture = {
        timestamps: new Float32Array(10000),
        channels: [
          {
            name: "A",
            label: "Input A",
            derived: false,
            data: new Float32Array(10000),
          },
          {
            name: "B",
            label: "Input B",
            derived: false,
            data: new Float32Array(5000),
          },
        ],
        derivedChannels: [],
        warnings: [],
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "20 ms/Div",
          secondsPerDiv: 0.02,
          timestamp14: "12000020260101",
          samples: 10000,
          deltaT: 2e-5,
          channels: [
            {
              name: "A",
              label: "Input A",
              derived: false,
              samples: 10000,
              deltaT: 2e-5,
            },
            {
              name: "B",
              label: "Input B",
              derived: false,
              samples: 5000,
              deltaT: 4e-5,
            },
          ],
        },
      };

      const model = buildMetadataModel(mockCapture, "diff.fvf");
      expect(model.isUniformSamples).toBe(false);
      expect(model.uniformSamplesCount).toBeNull();
      expect(model.samplesPerChannelText).toBeNull();
      expect(model.physicalChannels[0]?.tooltip).toBe("10,000 samples");
      expect(model.physicalChannels[1]?.tooltip).toBe("5,000 samples");
    });

    it("itemizes derived channels separately", () => {
      const mockCapture: ParsedCapture = {
        timestamps: new Float32Array(3000),
        channels: [
          {
            name: "A",
            label: "Input A",
            derived: false,
            data: new Float32Array(3000),
          },
        ],
        derivedChannels: [
          {
            label: "Mathematik A",
            recordLabel: "Mathematik A-B",
            sourceChannels: ["A", "B"],
            samples: 3000,
            deltaT: 3.33e-5,
            data: new Float32Array(3000),
          },
        ],
        warnings: [],
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "10 ms/Div",
          secondsPerDiv: 0.01,
          timestamp14: "12000020260101",
          samples: 3000,
          deltaT: 3.33e-5,
          channels: [
            {
              name: "A",
              label: "Input A",
              derived: false,
              samples: 3000,
              deltaT: 3.33e-5,
            },
            {
              name: "Mathematik A",
              label: "Mathematik A",
              derived: true,
              samples: 3000,
              deltaT: 3.33e-5,
            },
          ],
        },
      };

      const model = buildMetadataModel(mockCapture, "math.fvf");
      expect(model.physicalChannelCount).toBe(1);
      expect(model.physicalChannelsLabel).toBe("1 channel");
      expect(model.samplesPerChannelText).toBe("3,000 samples");
      expect(model.derivedChannels).toHaveLength(1);
      expect(model.derivedChannels[0]?.label).toBe("Mathematik A");
      expect(model.derivedChannels[0]?.formattedSamples).toBe("3,000 samples");
    });

    it("emits per-channel vertical lines when unit metadata is present", () => {
      const mockCapture: ParsedCapture = {
        timestamps: new Float32Array(9636),
        channels: [
          {
            name: "A",
            label: "Input A",
            derived: false,
            data: new Float32Array(9636),
          },
          {
            name: "B",
            label: "Input B",
            derived: false,
            data: new Float32Array(9636),
          },
        ],
        derivedChannels: [],
        warnings: [],
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "1 s/Div",
          secondsPerDiv: 1.0,
          timestamp14: "12000020260101",
          samples: 9636,
          deltaT: 0.0010377750103777502,
          channels: [
            {
              name: "A",
              label: "Input A",
              derived: false,
              samples: 9636,
              deltaT: 0.0010377750103777502,
              unit: "A",
              perDiv: 50,
            },
            {
              name: "B",
              label: "Input B",
              derived: false,
              samples: 9636,
              deltaT: 0.0010377750103777502,
              unit: "mA",
              perDiv: 0.1,
            },
          ],
        },
      };

      const model = buildMetadataModel(mockCapture, "current.fvf");
      expect(
        model.physicalChannels.map((channel) => channel.verticalLine),
      ).toEqual(["A: 50 A/Div", "B: 100 mA/Div"]);
    });

    it("renders canonical-SI per-division lines with an explicit raw fallback", () => {
      const channel = (
        unit: string | undefined,
        perDiv: number | undefined,
      ): ParsedCapture => ({
        timestamps: new Float32Array(10),
        channels: [
          {
            name: "C",
            label: "Input C",
            derived: false,
            data: new Float32Array(10),
          },
        ],
        derivedChannels: [],
        warnings: [],
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "10 ms/Div",
          secondsPerDiv: 0.01,
          timestamp14: "12000020260101",
          samples: 10,
          deltaT: 1e-5,
          channels: [
            {
              name: "C",
              label: "Input C",
              derived: false,
              samples: 10,
              deltaT: 1e-5,
              unit,
              perDiv,
            },
          ],
        },
      });

      // Canonical SI ladders from the base-SI magnitude: the file's display
      // prefix never leaks through (issue #106 supersedes the #103 folding).
      expect(
        buildMetadataModel(channel("kV", 500), "kv.fvf").physicalChannels[0]
          ?.verticalLine,
      ).toBe("C: 500 V/Div");
      expect(
        buildMetadataModel(channel("mV", 2), "mv.fvf").physicalChannels[0]
          ?.verticalLine,
      ).toBe("C: 2 V/Div");
      expect(
        buildMetadataModel(channel("", 200), "empty.fvf").physicalChannels[0]
          ?.verticalLine,
      ).toBe("C: 200 raw/Div");
      expect(
        buildMetadataModel(channel("V", undefined), "nounit.fvf")
          .physicalChannels[0]?.verticalLine,
      ).toBeNull();
    });

    it("leaves vertical lines null when unit metadata is absent", () => {
      const mockCapture: ParsedCapture = {
        timestamps: new Float32Array(100),
        channels: [
          {
            name: "A",
            label: "Input A",
            derived: false,
            data: new Float32Array(100),
          },
        ],
        derivedChannels: [],
        warnings: [],
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "10 ms/Div",
          secondsPerDiv: 0.01,
          timestamp14: "12000020260101",
          samples: 100,
          deltaT: 1e-5,
          channels: [
            {
              name: "A",
              label: "Input A",
              derived: false,
              samples: 100,
              deltaT: 1e-5,
            },
          ],
        },
      };

      const model = buildMetadataModel(mockCapture, "legacy.fvf");
      expect(model.physicalChannels[0]?.verticalLine).toBeNull();
    });

    it("populates tooltips with custom channel names and non-uniform sample counts", () => {
      const mockCapture: ParsedCapture = {
        timestamps: new Float32Array(10000),
        channels: [
          {
            name: "A",
            label: "Input A",
            derived: false,
            data: new Float32Array(10000),
          },
          {
            name: "B",
            label: "Input B",
            derived: false,
            data: new Float32Array(5000),
          },
          {
            name: "C",
            label: "Input C",
            derived: false,
            data: new Float32Array(5000),
          },
        ],
        derivedChannels: [],
        warnings: [],
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "10 ms/Div",
          secondsPerDiv: 0.01,
          timestamp14: "12000020260101",
          samples: 10000,
          deltaT: 1e-5,
          channels: [
            {
              name: "A",
              label: "Input A",
              derived: false,
              samples: 10000,
              deltaT: 1e-5,
            },
            {
              name: "B",
              label: "Input B",
              derived: false,
              samples: 5000,
              deltaT: 2e-5,
            },
            {
              name: "C",
              label: "Input C",
              derived: false,
              samples: 5000,
              deltaT: 2e-5,
            },
          ],
        },
      };

      const customNames = {
        A: "Grid Voltage",
        B: "Shunt Current",
      };

      const model = buildMetadataModel(mockCapture, "custom.fvf", customNames);
      expect(model.isUniformSamples).toBe(false);
      expect(model.physicalChannels[0]?.tooltip).toBe(
        "Grid Voltage (10,000 samples)",
      );
      expect(model.physicalChannels[1]?.tooltip).toBe(
        "Shunt Current (5,000 samples)",
      );
      expect(model.physicalChannels[2]?.tooltip).toBe("5,000 samples");
    });

    it("populates tooltips with custom channel names only when sample counts are uniform", () => {
      const mockCapture: ParsedCapture = {
        timestamps: new Float32Array(10000),
        channels: [
          {
            name: "A",
            label: "Input A",
            derived: false,
            data: new Float32Array(10000),
          },
          {
            name: "B",
            label: "Input B",
            derived: false,
            data: new Float32Array(10000),
          },
        ],
        derivedChannels: [],
        warnings: [],
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "10 ms/Div",
          secondsPerDiv: 0.01,
          timestamp14: "12000020260101",
          samples: 10000,
          deltaT: 1e-5,
          channels: [
            {
              name: "A",
              label: "Input A",
              derived: false,
              samples: 10000,
              deltaT: 1e-5,
            },
            {
              name: "B",
              label: "Input B",
              derived: false,
              samples: 10000,
              deltaT: 1e-5,
            },
          ],
        },
      };

      const model = buildMetadataModel(mockCapture, "custom.fvf", {
        A: "Grid Voltage",
      });
      expect(model.isUniformSamples).toBe(true);
      expect(model.physicalChannels[0]?.tooltip).toBe("Grid Voltage");
      expect(model.physicalChannels[1]?.tooltip).toBeUndefined();
    });

    it("AC3 (issue #131): surfaces canonical per-division, stored window, saturated samples, and custom name in letter tooltips", () => {
      const mockCapture: ParsedCapture = {
        timestamps: new Float32Array(10000),
        channels: [
          {
            name: "A",
            label: "Input A",
            derived: false,
            data: new Float32Array(10000),
          },
          {
            name: "B",
            label: "Input B",
            derived: false,
            data: new Float32Array(10000),
          },
        ],
        derivedChannels: [],
        warnings: [],
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "10 ms/Div",
          secondsPerDiv: 0.01,
          timestamp14: "12000020260101",
          samples: 10000,
          deltaT: 1e-5,
          channels: [
            {
              name: "A",
              label: "Input A",
              derived: false,
              samples: 10000,
              deltaT: 1e-5,
              unit: "V",
              perDiv: 200,
              windowMin: -800,
              windowMax: 800,
              saturatedSamples: 5,
            },
            {
              name: "B",
              label: "Input B",
              derived: false,
              samples: 10000,
              deltaT: 1e-5,
              unit: "mA",
              perDiv: 0.1,
              windowMin: -0.3,
              windowMax: 0.5,
              saturatedSamples: 0,
            },
          ],
        },
      };

      const model = buildMetadataModel(mockCapture, "test.fvf", {
        A: "Grid Voltage",
      });

      // Channel A has custom name + canonical perDiv + window + saturated count
      expect(model.physicalChannels[0]?.tooltip).toBe(
        "Grid Voltage · 200 V/Div · [-800, 800] V · 5 saturated",
      );
      // Channel B has canonical perDiv + window, 0 saturated (omitted), no custom name
      expect(model.physicalChannels[1]?.tooltip).toBe(
        "100 mA/Div · [-0.3, 0.5] A",
      );
    });
  });
});
