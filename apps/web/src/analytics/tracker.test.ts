import { describe, expect, it } from "vitest";
import { getUmamiWebsiteId, initAnalytics, trackEvent } from "./tracker";

describe("analytics tracker in Node environment", () => {
  it("getUmamiWebsiteId returns null when window is not defined", () => {
    expect(getUmamiWebsiteId()).toBeNull();
  });

  it("initAnalytics safely returns false and does not throw in Node", () => {
    expect(initAnalytics()).toBe(false);
  });

  it("trackEvent safely no-ops without throwing in Node", () => {
    expect(() => {
      trackEvent("export_csv");
      trackEvent("file_loaded", { source: "upload" });
      trackEvent("layout_toggled", { mode: "stack" });
      trackEvent("export_png", { action: "download" });
      trackEvent("parse_error", { error_type: "unsupported_format" });
    }).not.toThrow();
  });
});
