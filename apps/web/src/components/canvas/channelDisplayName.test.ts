import { describe, expect, it } from "vitest";
import {
  channelDisplayName,
  formatReadoutChannelName,
} from "../../state/channelNamesStore";

describe("channelDisplayName (issue #64)", () => {
  it("renders amendments as '<letter>: <custom>'", () => {
    expect(channelDisplayName("A", "Input A", "V_grid")).toBe("A: V_grid");
  });

  it("falls back to the capture label without an amendment", () => {
    expect(channelDisplayName("A", "Input A", undefined)).toBe("Input A");
    expect(channelDisplayName("A", undefined, undefined)).toBe("A");
    expect(channelDisplayName("A", null, null)).toBe("A");
  });

  it("treats whitespace-only amendments as absent", () => {
    expect(channelDisplayName("A", "Input A", "   ")).toBe("Input A");
  });
});

describe("formatReadoutChannelName (issue #131)", () => {
  it("strips 'Input ' prefix from channel labels (AC1)", () => {
    expect(formatReadoutChannelName("A", "Input A", undefined)).toBe("A");
    expect(formatReadoutChannelName("B", "Input B", undefined)).toBe("B");
    expect(formatReadoutChannelName("CH1", "Input CH1", undefined)).toBe("CH1");
  });

  it("formats custom name with channel tag when set (AC1)", () => {
    expect(formatReadoutChannelName("A", "Input A", "V_grid")).toBe(
      "A: V_grid",
    );
    expect(formatReadoutChannelName("B", "Input B", "Load Current")).toBe(
      "B: Load Current",
    );
  });

  it("falls back to channel tag when label is missing", () => {
    expect(formatReadoutChannelName("A", undefined, undefined)).toBe("A");
    expect(formatReadoutChannelName("A", null, null)).toBe("A");
  });
});
