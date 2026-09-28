import { describe, expect, it } from "vitest";
import {
  CURSOR_MOVEMENT_GUIDE,
  CURSOR_MOVEMENT_SUMMARY,
  getCursorHandleAriaLabel,
  getCursorHandleTitle,
} from "./cursorHelp";

describe("cursorHelp", () => {
  it("defines summary string containing key movement controls", () => {
    expect(CURSOR_MOVEMENT_SUMMARY).toContain(
      "Ctrl+Drag or Ctrl+Click to move",
    );
    expect(CURSOR_MOVEMENT_SUMMARY).toContain(
      "Ctrl+Wheel or Ctrl+Arrow keys to step",
    );
  });

  it("defines guide text containing all four control methods without inaccurate modifier claims", () => {
    expect(CURSOR_MOVEMENT_GUIDE).toContain("Cursor Movement Controls");
    expect(CURSOR_MOVEMENT_GUIDE).toContain("• Ctrl + Drag");
    expect(CURSOR_MOVEMENT_GUIDE).toContain("• Ctrl + Click");
    expect(CURSOR_MOVEMENT_GUIDE).toContain("• Ctrl + Mousewheel");
    expect(CURSOR_MOVEMENT_GUIDE).toContain("• Ctrl + Arrow keys");
    expect(CURSOR_MOVEMENT_GUIDE).not.toContain("Shift for 10x");
  });

  it("formats handle title correctly for C1 and C2", () => {
    const c1Title = getCursorHandleTitle("C1");
    const c2Title = getCursorHandleTitle("C2");

    expect(c1Title).toContain("Cursor C1");
    expect(c1Title).toContain("Ctrl + Drag");
    expect(c1Title).not.toContain("Shift for 10x");

    expect(c2Title).toContain("Cursor C2");
    expect(c2Title).toContain("Ctrl + Drag");
    expect(c2Title).not.toContain("Shift for 10x");
  });

  it("formats handle aria-label correctly for C1 and C2", () => {
    expect(getCursorHandleAriaLabel("C1")).toBe(
      `Cursor C1: ${CURSOR_MOVEMENT_SUMMARY}`,
    );
    expect(getCursorHandleAriaLabel("C2")).toBe(
      `Cursor C2: ${CURSOR_MOVEMENT_SUMMARY}`,
    );
  });
});
