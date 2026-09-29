import { describe, expect, it } from "vitest";
import { ERROR_TITLES, getErrorTitle, parseErrorDetails } from "./errorDetails";
import { PARSE_ERROR_CODES, type StoreErrorCode } from "../../types/capture";

describe("errorDetails safe details-JSON parsing and title mappings", () => {
  describe("getErrorTitle", () => {
    it("maps all 8 parser taxonomy codes plus worker_error to human-readable titles", () => {
      const allCodes: StoreErrorCode[] = [...PARSE_ERROR_CODES, "worker_error"];

      for (const code of allCodes) {
        const title = getErrorTitle(code);
        expect(title).toBe(ERROR_TITLES[code]);
        expect(title.length).toBeGreaterThan(0);
        expect(title).not.toBe("Parse Error");
      }
    });

    it("returns 'Parse Error' fallback for unknown codes", () => {
      expect(getErrorTitle("unknown_code")).toBe("Parse Error");
      expect(getErrorTitle("")).toBe("Parse Error");
    });
  });

  describe("parseErrorDetails", () => {
    it("safely extracts invalid_signature detected bytes (hex and ASCII)", () => {
      const json = JSON.stringify({
        detectedHex: "58 58 2e 58 56 46 1a 00",
        detectedAscii: "XX.XVF..",
      });
      const parsed = parseErrorDetails(json);
      expect(parsed?.detectedHex).toBe("58 58 2e 58 56 46 1a 00");
      expect(parsed?.detectedAscii).toBe("XX.XVF..");
    });

    it("safely extracts unsupported_capture_variant detected tag bytes", () => {
      const json = JSON.stringify({
        detectedTagHex: "46 56 2e 46 56 53",
        detectedTag: "FV.FVS",
      });
      const parsed = parseErrorDetails(json);
      expect(parsed?.detectedTagHex).toBe("46 56 2e 46 56 53");
      expect(parsed?.detectedTag).toBe("FV.FVS");
    });

    it("safely extracts unsupported_capture_version details", () => {
      const parsed = parseErrorDetails(JSON.stringify({ version: 2 }));
      expect(parsed?.version).toBe(2);
    });

    it("safely extracts invalid_timebase_format token", () => {
      const parsed = parseErrorDetails(JSON.stringify({ token: "abc us/div" }));
      expect(parsed?.token).toBe("abc us/div");
    });

    it("safely extracts invalid_timebase_range secondsPerDiv", () => {
      const parsed = parseErrorDetails(
        JSON.stringify({ secondsPerDiv: 1e-10 }),
      );
      expect(parsed?.secondsPerDiv).toBe(1e-10);
    });

    it("safely extracts truncated_capture needed and available bytes", () => {
      const parsed = parseErrorDetails(
        JSON.stringify({ needed: 830, available: 500 }),
      );
      expect(parsed?.needed).toBe(830);
      expect(parsed?.available).toBe(500);
    });

    it("safely parses empty object detail for opaque_header", () => {
      const parsed = parseErrorDetails("{}");
      expect(parsed).toEqual({});
    });

    it("safely extracts corrupt_sector_table detail message", () => {
      const parsed = parseErrorDetails(
        JSON.stringify({ detail: "corrupt offset" }),
      );
      expect(parsed?.detail).toBe("corrupt offset");
    });

    it("returns null for worker_error (empty string) and null/undefined inputs", () => {
      expect(parseErrorDetails("")).toBeNull();
      expect(parseErrorDetails("   ")).toBeNull();
      expect(parseErrorDetails(null)).toBeNull();
      expect(parseErrorDetails(undefined)).toBeNull();
    });

    it("degrades gracefully to null on malformed JSON without throwing", () => {
      expect(parseErrorDetails("{malformed json")).toBeNull();
      expect(parseErrorDetails("not json at all")).toBeNull();
      expect(parseErrorDetails("123")).toBeNull();
      expect(parseErrorDetails("[1, 2, 3]")).toBeNull();
    });
  });
});
