import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUmamiWebsiteId, initAnalytics, trackEvent } from "./tracker";

describe("analytics tracker in browser environment (issue #277)", () => {
  beforeEach(() => {
    delete window.__UMAMI_WEBSITE_ID__;
    delete window.umami;
    document
      .querySelectorAll('meta[name="umami-website-id"]')
      .forEach((el) => el.remove());
    document
      .querySelectorAll('script[data-analytics="umami"]')
      .forEach((el) => el.remove());
  });

  afterEach(() => {
    delete window.__UMAMI_WEBSITE_ID__;
    delete window.umami;
    document
      .querySelectorAll('meta[name="umami-website-id"]')
      .forEach((el) => el.remove());
    document
      .querySelectorAll('script[data-analytics="umami"]')
      .forEach((el) => el.remove());
  });

  describe("getUmamiWebsiteId", () => {
    it("returns null when neither meta tag nor window global is present", () => {
      expect(getUmamiWebsiteId()).toBeNull();
    });

    it("resolves from window.__UMAMI_WEBSITE_ID__", () => {
      window.__UMAMI_WEBSITE_ID__ = "win-id-123";
      expect(getUmamiWebsiteId()).toBe("win-id-123");
    });

    it("resolves from meta[name='umami-website-id'] tag", () => {
      const meta = document.createElement("meta");
      meta.name = "umami-website-id";
      meta.content = "meta-id-456";
      document.head.appendChild(meta);

      expect(getUmamiWebsiteId()).toBe("meta-id-456");
    });
  });

  describe("initAnalytics", () => {
    it("safely returns false and injects nothing when website ID is absent", () => {
      const res = initAnalytics();
      expect(res).toBe(false);
      expect(
        document.querySelector('script[data-analytics="umami"]'),
      ).toBeNull();
    });

    it("injects Umami script with required data attributes when website ID is present", () => {
      window.__UMAMI_WEBSITE_ID__ = "test-site-uuid";

      const res = initAnalytics();
      expect(res).toBe(true);

      const script = document.querySelector<HTMLScriptElement>(
        'script[data-analytics="umami"]',
      );
      expect(script).not.toBeNull();
      expect(script?.src).toContain("/stats/script.js");
      expect(script?.getAttribute("data-host-url")).toBe("/stats");
      expect(script?.getAttribute("data-do-not-track")).toBe("true");
      expect(script?.getAttribute("data-website-id")).toBe("test-site-uuid");
      expect(script?.defer).toBe(true);
    });

    it("is idempotent and does not inject multiple scripts", () => {
      window.__UMAMI_WEBSITE_ID__ = "test-site-uuid";

      expect(initAnalytics()).toBe(true);
      expect(initAnalytics()).toBe(true);

      const scripts = document.querySelectorAll(
        'script[data-analytics="umami"]',
      );
      expect(scripts.length).toBe(1);
    });
  });

  describe("trackEvent", () => {
    it("safely no-ops when window.umami is undefined", () => {
      expect(() => {
        trackEvent("export_csv");
        trackEvent("layout_toggled", { mode: "stack" });
        trackEvent("file_loaded", { source: "upload" });
        trackEvent("export_png", { action: "download" });
        trackEvent("parse_error", { error_type: "corrupt_file" });
      }).not.toThrow();
    });

    it("invokes window.umami.track with event name and payload when defined", () => {
      const trackSpy = vi.fn();
      window.umami = { track: trackSpy };

      trackEvent("file_loaded", { source: "upload" });
      expect(trackSpy).toHaveBeenCalledWith("file_loaded", {
        source: "upload",
      });

      trackEvent("export_png", { action: "clipboard_copy" });
      expect(trackSpy).toHaveBeenCalledWith("export_png", {
        action: "clipboard_copy",
      });

      trackEvent("layout_toggled", { mode: "overlay" });
      expect(trackSpy).toHaveBeenCalledWith("layout_toggled", {
        mode: "overlay",
      });

      trackEvent("parse_error", { error_type: "unsupported_format" });
      expect(trackSpy).toHaveBeenCalledWith("parse_error", {
        error_type: "unsupported_format",
      });
    });

    it("invokes window.umami.track without payload for export_csv", () => {
      const trackSpy = vi.fn();
      window.umami = { track: trackSpy };

      trackEvent("export_csv");
      expect(trackSpy).toHaveBeenCalledWith("export_csv");
    });

    it("catches and suppresses any exceptions thrown by window.umami.track", () => {
      window.umami = {
        track: () => {
          throw new Error("Umami network error");
        },
      };

      expect(() => {
        trackEvent("export_csv");
      }).not.toThrow();
    });
  });
});
