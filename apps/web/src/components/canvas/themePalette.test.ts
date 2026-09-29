import { describe, expect, it } from "vitest";
import {
  type CustomColors,
  PALETTE_KEYS,
  channelTag,
  defaultColorForKey,
  effectiveColorForKey,
  effectiveCursorColor,
  effectiveTraceColor,
  isHexColor,
} from "./themePalette";

describe("user-configurable palette resolution (issue #40)", () => {
  it("exposes exactly the six customizable palette keys", () => {
    expect(PALETTE_KEYS).toEqual(["A", "B", "C", "D", "C1", "C2"]);
  });

  it("hex validation accepts #RGB/#RRGGBB and rejects everything else", () => {
    expect(isHexColor("#FFD700")).toBe(true);
    expect(isHexColor("#f00")).toBe(true);
    expect(isHexColor("#00bfff")).toBe(true);
    expect(isHexColor("FFD700")).toBe(false);
    expect(isHexColor("#GGGGGG")).toBe(false);
    expect(isHexColor("#12345")).toBe(false);
    expect(isHexColor("#1234567")).toBe(false);
    expect(isHexColor("")).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(42)).toBe(false);
  });

  it("theme defaults are returned when no override exists", () => {
    const custom = {};
    expect(effectiveColorForKey("dark", custom, "A")).toBe("#FFD700");
    expect(effectiveColorForKey("dark", custom, "C1")).toBe("#E040FB");
    expect(effectiveColorForKey("light", custom, "A")).toBe("#B8860B");
    expect(effectiveColorForKey("light", custom, "C2")).toBe("#4B5563");
  });

  it("user overrides win over theme defaults and render as authored in both themes", () => {
    const custom = { A: "#123456", C1: "#ABC" };
    expect(effectiveColorForKey("dark", custom, "A")).toBe("#123456");
    expect(effectiveColorForKey("light", custom, "A")).toBe("#123456");
    expect(effectiveColorForKey("dark", custom, "C1")).toBe("#ABC");
    expect(effectiveColorForKey("light", custom, "C1")).toBe("#ABC");
    // Untouched entries keep theme-adapted defaults
    expect(effectiveColorForKey("light", custom, "B")).toBe("#1E90FF");
  });

  it("defaultColorForKey exposes the architecture 4.1 standard palette in dark", () => {
    expect(defaultColorForKey("dark", "A")).toBe("#FFD700");
    expect(defaultColorForKey("dark", "B")).toBe("#00BFFF");
    expect(defaultColorForKey("dark", "C")).toBe("#FF4500");
    expect(defaultColorForKey("dark", "D")).toBe("#00FF7F");
    expect(defaultColorForKey("dark", "C1")).toBe("#E040FB");
    expect(defaultColorForKey("dark", "C2")).toBe("#B0B0B0");
  });

  it("light Channel B default is distinct from C1 and the old navy (issue #145)", () => {
    const custom: CustomColors = {};
    expect(defaultColorForKey("light", "B")).toBe("#1E90FF");
    expect(effectiveColorForKey("light", custom, "B")).toBe("#1E90FF");
    // The old navy was easily confused with the C1 cursor purple and
    // vanished on the dark toolbar chrome; the replacement is neither.
    expect(effectiveColorForKey("light", custom, "B")).not.toBe(
      effectiveColorForKey("light", custom, "C1"),
    );
    expect(effectiveColorForKey("light", custom, "B")).not.toBe("#00008B");
  });

  it("effectiveTraceColor accepts tagged and Input-prefixed names and falls back for unknown channels", () => {
    const custom = { B: "#654321" };
    expect(effectiveTraceColor("dark", custom, "B")).toBe("#654321");
    expect(effectiveTraceColor("dark", custom, "Input B")).toBe("#654321");
    expect(effectiveTraceColor("dark", custom, "A")).toBe("#FFD700");
    expect(effectiveTraceColor("light", {}, "Input D")).toBe("#228B22");
    expect(
      effectiveTraceColor(
        "dark",
        { MATH1: "#111111" } as CustomColors,
        "MATH1",
      ),
    ).toBe("#00BFFF");
  });

  it("effectiveCursorColor resolves C1/C2 with overrides", () => {
    expect(effectiveCursorColor("dark", {}, "C2")).toBe("#B0B0B0");
    expect(effectiveCursorColor("dark", { C2: "#00FFAA" }, "C2")).toBe(
      "#00FFAA",
    );
  });

  it("channelTag normalizes Input-prefixed names", () => {
    expect(channelTag("Input C")).toBe("C");
    expect(channelTag("C")).toBe("C");
    expect(channelTag("input a")).toBe("a");
  });
});
