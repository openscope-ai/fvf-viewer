import { describe, expect, it } from "vitest";
import {
  blendOverChecker,
  isLowContrastOnDark,
  pencilOverlayColor,
  previewStroke,
} from "./colorMath";
import {
  expandHex,
  hexRgb,
  rgbaFromHex,
  relativeLuminance,
} from "../../canvas/themePalette";

describe("badgeConfig colorMath (issue #204)", () => {
  it("hexRgb expands 3- and 6-digit hex", () => {
    expect(hexRgb("#ABC")).toEqual([170, 187, 204]);
    expect(hexRgb("#00BFFF")).toEqual([0, 191, 255]);
  });

  it("rgbaFromHex returns canonical hex at full opacity, rgba below", () => {
    expect(rgbaFromHex("#00BFFF", 100)).toBe("#00BFFF");
    expect(rgbaFromHex("#00BFFF", 50)).toBe("rgba(0, 191, 255, 0.50)");
    expect(rgbaFromHex("#ABC", 25)).toBe("rgba(170, 187, 204, 0.25)");
    // Out-of-range values clamp, never exceed [0, 1] alpha
    expect(rgbaFromHex("#FFD700", 500)).toBe("#FFD700");
    expect(rgbaFromHex("#FFD700", -3)).toBe("rgba(255, 215, 0, 0.00)");
  });

  it("relativeLuminance matches WCAG anchor points", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    // Gold #FFD700 luminance ≈ 0.699
    expect(relativeLuminance("#FFD700")).toBeGreaterThan(0.65);
    expect(relativeLuminance("#FFD700")).toBeLessThan(0.75);
  });

  it("expandHex canonicalizes shorthand for consumers needing #rrggbb", () => {
    expect(expandHex("#ABC")).toBe("#aabbcc");
    expect(expandHex("#00BFFF")).toBe("#00bfff");
  });

  it("blendOverChecker fades toward the checker average with opacity", () => {
    const [r] = blendOverChecker("#FFFFFF", 50);
    expect(r).toBeCloseTo((255 + 0x25) / 2, 3);
    expect(blendOverChecker("#FF0000", 100)).toEqual([255, 0, 0]);
    // #RGB shorthand parses identically to its 6-digit expansion.
    expect(blendOverChecker("#AbC", 100)).toEqual(
      blendOverChecker("#aabbcc", 100),
    );
    const [r0] = blendOverChecker("#FF0000", 0);
    expect(r0).toBeCloseTo(0x25, 3);
  });

  it("pencilOverlayColor flips by blended luminance, following opacity", () => {
    // Bright gold at full opacity -> near-black pencil
    expect(pencilOverlayColor("#FFD700", 100)).toBe("rgba(0, 0, 0, 0.72)");
    // The same gold scrubbed far down blends toward the dark checkerboard
    // average, so the pencil flips to near-white.
    expect(pencilOverlayColor("#FFD700", 15)).toBe("rgba(255, 255, 255, 0.88)");
    // Near-black stays near-white-penciled at any opacity
    expect(pencilOverlayColor("#050505", 100)).toBe(
      "rgba(255, 255, 255, 0.88)",
    );
  });

  it("previewStroke is the rgba() stroke at the chosen opacity", () => {
    expect(previewStroke("#00BFFF", 100)).toBe("#00BFFF");
    expect(previewStroke("#00BFFF", 75)).toBe("rgba(0, 191, 255, 0.75)");
  });

  it("low-contrast guard flags only dim trace colors on the dark canvas", () => {
    expect(isLowContrastOnDark("#00008B")).toBe(true);
    expect(isLowContrastOnDark("#050505")).toBe(true);
    expect(isLowContrastOnDark("#FFD700")).toBe(false);
    expect(isLowContrastOnDark("#00BFFF")).toBe(false);
  });
});
