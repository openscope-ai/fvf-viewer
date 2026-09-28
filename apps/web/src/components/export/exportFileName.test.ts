import { describe, expect, it } from "vitest";
import {
  csvFileName,
  formatCompactTimestamp,
  snapshotFileName,
} from "./exportFileName";

describe("Export filename formatting with compact timestamps (Issue #87)", () => {
  const fixedDate = new Date(2026, 8, 14, 10, 35, 22); // 2026-09-14 10:35:22 local

  describe("formatCompactTimestamp", () => {
    it("formats a Date instance into YYYYMMDD-HHmmss format", () => {
      expect(formatCompactTimestamp(fixedDate)).toBe("20260914-103522");
    });

    it("zero-pads single digit month, day, hours, minutes, and seconds", () => {
      const earlyDate = new Date(2026, 0, 5, 4, 3, 2); // 2026-01-05 04:03:02
      expect(formatCompactTimestamp(earlyDate)).toBe("20260105-040302");
    });

    it("defaults to current date when omitted", () => {
      const ts = formatCompactTimestamp();
      expect(ts).toMatch(/^\d{8}-\d{6}$/);
    });
  });

  describe("snapshotFileName", () => {
    it("appends -snapshot-YYYYMMDD-HHmmss.png to capture file stem", () => {
      expect(snapshotFileName("capture.fvf", fixedDate)).toBe(
        "capture-snapshot-20260914-103522.png",
      );
      expect(snapshotFileName("CAPTURE.FVF", fixedDate)).toBe(
        "CAPTURE-snapshot-20260914-103522.png",
      );
      expect(snapshotFileName("math verify Delta.fvf", fixedDate)).toBe(
        "math verify Delta-snapshot-20260914-103522.png",
      );
    });

    it("falls back to snapshot-YYYYMMDD-HHmmss.png when fileName is null or empty", () => {
      expect(snapshotFileName(null, fixedDate)).toBe(
        "snapshot-20260914-103522.png",
      );
      expect(snapshotFileName("", fixedDate)).toBe(
        "snapshot-20260914-103522.png",
      );
    });

    it("AC3: subsequent exports within different seconds generate distinct filenames with zero collision", () => {
      const date1 = new Date(2026, 8, 14, 10, 35, 22);
      const date2 = new Date(2026, 8, 14, 10, 35, 23);
      const name1 = snapshotFileName("capture.fvf", date1);
      const name2 = snapshotFileName("capture.fvf", date2);
      expect(name1).not.toBe(name2);
      expect(name1).toBe("capture-snapshot-20260914-103522.png");
      expect(name2).toBe("capture-snapshot-20260914-103523.png");
    });
  });

  describe("csvFileName", () => {
    it("appends -YYYYMMDD-HHmmss.csv to capture file stem", () => {
      expect(csvFileName("capture.fvf", fixedDate)).toBe(
        "capture-20260914-103522.csv",
      );
      expect(csvFileName("CAPTURE.FVF", fixedDate)).toBe(
        "CAPTURE-20260914-103522.csv",
      );
      expect(csvFileName("math verify Delta.fvf", fixedDate)).toBe(
        "math verify Delta-20260914-103522.csv",
      );
    });

    it("falls back to capture-YYYYMMDD-HHmmss.csv when fileName is null or empty", () => {
      expect(csvFileName(null, fixedDate)).toBe("capture-20260914-103522.csv");
      expect(csvFileName("", fixedDate)).toBe("capture-20260914-103522.csv");
    });

    it("AC3: subsequent exports within different seconds generate distinct filenames with zero collision", () => {
      const date1 = new Date(2026, 8, 14, 10, 35, 22);
      const date2 = new Date(2026, 8, 14, 10, 35, 23);
      const name1 = csvFileName("scope.fvf", date1);
      const name2 = csvFileName("scope.fvf", date2);
      expect(name1).not.toBe(name2);
      expect(name1).toBe("scope-20260914-103522.csv");
      expect(name2).toBe("scope-20260914-103523.csv");
    });
  });
});
