/**
 * Umami Cloud privacy-friendly analytics client wrapper (issue #277).
 *
 * All telemetry is strictly anonymized, cookie-free, and respects FVF Viewer's
 * core commitment: 100% client-side parsing where captures are never uploaded
 * and user data is never shared. No capture metadata (such as filenames,
 * timestamps, instrument serials, channel names, or sample values) may ever
 * be included in any analytics payload.
 *
 * When UMAMI_WEBSITE_ID is not configured, this tracker safely no-ops with zero
 * network requests, zero DOM modifications, and zero console errors.
 */

export type AnalyticsEvent =
  | {
      name: "file_loaded";
      data: { source: "upload" | "sample_demo" | "compare" };
    }
  | { name: "export_csv"; data?: never }
  | { name: "export_png"; data: { action: "download" | "clipboard_copy" } }
  | { name: "layout_toggled"; data: { mode: "stack" | "overlay" } }
  | { name: "parse_error"; data: { error_type: string } };

export type EventName = AnalyticsEvent["name"];
export type EventData<T extends EventName> =
  Extract<AnalyticsEvent, { name: T }> extends {
    data: infer D;
  }
    ? D
    : never;

declare global {
  interface Window {
    __UMAMI_WEBSITE_ID__?: string;
    umami?: {
      track: {
        (name: string, data?: Record<string, unknown>): void;
        (customPayload?: Record<string, unknown>): void;
      };
    };
  }
}

/** Resolves configured Umami website ID without emitting network requests. */
export function getUmamiWebsiteId(): string | null {
  if (typeof window === "undefined") return null;

  if (window.__UMAMI_WEBSITE_ID__) {
    return window.__UMAMI_WEBSITE_ID__;
  }

  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="umami-website-id"]');
    const content = meta?.getAttribute("content")?.trim();
    if (content) return content;
  }

  if (typeof import.meta !== "undefined" && import.meta.env) {
    const viteEnvId = import.meta.env.VITE_UMAMI_WEBSITE_ID;
    if (typeof viteEnvId === "string" && viteEnvId.trim()) {
      return viteEnvId.trim();
    }
  }

  return null;
}

export interface InitAnalyticsOptions {
  websiteId?: string;
  hostUrl?: string;
  scriptUrl?: string;
}

/**
 * Conditionally initializes Umami script if a website ID is configured.
 * When absent, safely no-ops without any DOM injection or network traffic.
 */
export function initAnalytics(options?: InitAnalyticsOptions): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const websiteId = options?.websiteId ?? getUmamiWebsiteId();
  if (!websiteId) {
    return false;
  }

  // Idempotent: avoid injecting script multiple times
  if (document.querySelector('script[data-analytics="umami"]')) {
    return true;
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = options?.scriptUrl ?? "/stats/script.js";
  script.setAttribute("data-host-url", options?.hostUrl ?? "/stats");
  script.setAttribute("data-do-not-track", "true");
  script.setAttribute("data-website-id", websiteId);
  script.setAttribute("data-analytics", "umami");
  document.head.appendChild(script);
  return true;
}

/**
 * Dispatches an analytics event to window.umami if present.
 * Safely no-ops if analytics is disabled or window.umami is undefined.
 */
export function trackEvent(name: "export_csv"): void;
export function trackEvent<T extends Exclude<EventName, "export_csv">>(
  name: T,
  data: EventData<T>,
): void;
export function trackEvent(
  name: EventName,
  data?: Record<string, unknown>,
): void {
  try {
    if (
      typeof window !== "undefined" &&
      window.umami &&
      typeof window.umami.track === "function"
    ) {
      if (data) {
        window.umami.track(name, data);
      } else {
        window.umami.track(name);
      }
    }
  } catch {
    // Analytics failure must never disrupt application execution or user experience
  }
}
