import type { StaticPageDefinition } from "../types";

export interface FaqItem {
  question: string;
  answerHtml: string;
  answerText: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Does FVF Viewer upload my .fvf files to a server?",
    answerHtml: `
      <p>
        <strong>No.</strong> FVF Viewer operates entirely client-side in your browser using a high-performance WebAssembly engine compiled from Rust.
        Your waveform files are read directly from local memory and are never uploaded, transmitted over the network, or stored on any remote server.
        You can verify this by inspecting network activity in your browser's developer tools or by disconnecting your internet connection after loading the page.
      </p>
    `,
    answerText:
      "No. FVF Viewer operates entirely client-side in your browser using a high-performance WebAssembly engine compiled from Rust. Your waveform files are read directly from local memory and are never uploaded, transmitted over the network, or stored on any remote server. You can verify this by inspecting network activity in your browser's developer tools or by disconnecting your internet connection after loading the page.",
  },
  {
    question: "What screen size and browser are required to use FVF Viewer?",
    answerHtml: `
      <p>
        FVF Viewer requires a modern desktop or tablet browser (such as Chrome, Firefox, Safari, or Edge) with a viewport width of at least <strong>1024 pixels</strong>.
        Because multi-channel waveform analysis requires horizontal space for timebase sweeps, dual cursors, and channel lanes, viewports narrower than 1024px display a screen orientation guidance modal asking you to widen your browser or rotate your device to landscape.
      </p>
    `,
    answerText:
      "FVF Viewer requires a modern desktop or tablet browser (such as Chrome, Firefox, Safari, or Edge) with a viewport width of at least 1024 pixels. Because multi-channel waveform analysis requires horizontal space for timebase sweeps, dual cursors, and channel lanes, viewports narrower than 1024px display a screen orientation guidance modal asking you to widen your browser or rotate your device to landscape.",
  },
  {
    question: "Can I export waveform data and snapshots from FVF Viewer?",
    answerHtml: `
      <p>
        <strong>Yes.</strong> You can export waveform data to lossless CSV files with customizable delimiters (comma or semicolon) for individual channels, reference captures, or composite datasets.
        You can also export high-resolution PNG canvas snapshots with standard dark theme or inverted print-friendly styling.
      </p>
    `,
    answerText:
      "Yes. You can export waveform data to lossless CSV files with customizable delimiters (comma or semicolon) for individual channels, reference captures, or composite datasets. You can also export high-resolution PNG canvas snapshots with standard dark theme or inverted print-friendly styling.",
  },
  {
    question:
      "What happens if my .fvf file is corrupt, truncated, or unsupported?",
    answerHtml: `
      <p>
        The parser validates the file's 8-byte signature (<code>FV.FVF\\x1a\\x00</code>), format version, record layout grammar, and physical parameter bounds.
        If a file is truncated, damaged, or carries an unsupported variant, FVF Viewer halts safely and displays a typed error modal detailing the exact failure (such as <code>invalid_signature</code> with detected bytes, <code>truncated_capture</code>, or <code>invalid_timebase_range</code>).
        Files with non-critical irregularities display non-blocking warning badges while continuing to render valid channels.
      </p>
    `,
    answerText:
      "The parser validates the file's 8-byte signature (FV.FVF\\x1a\\x00), format version, record layout grammar, and physical parameter bounds. If a file is truncated, damaged, or carries an unsupported variant, FVF Viewer halts safely and displays a typed error modal detailing the exact failure (such as invalid_signature with detected bytes, truncated_capture, or invalid_timebase_range). Files with non-critical irregularities display non-blocking warning badges while continuing to render valid channels.",
  },
  {
    question: "Can I try FVF Viewer without having a ScopeMeter .fvf file?",
    answerHtml: `
      <p>
        <strong>Yes.</strong> The home screen includes a built-in sample capture button (<em>"Test fvf • viewer with a 100k sample synthetic capture"</em>) that instantly loads a bundled 100,000-sample ScopeMeter waveform with pre-configured analog channels, dual cursors, and live measurements.
      </p>
    `,
    answerText:
      'Yes. The home screen includes a built-in sample capture button ("Test fvf • viewer with a 100k sample synthetic capture") that instantly loads a bundled 100,000-sample ScopeMeter waveform with pre-configured analog channels, dual cursors, and live measurements.',
  },
];

export const faqPage: StaticPageDefinition = {
  meta: {
    title: "Frequently Asked Questions (FAQ) — FVF Viewer",
    description:
      "Frequently asked questions about FVF Viewer: in-browser zero-upload privacy, browser and viewport requirements, CSV/PNG exports, file validation, and sample capture.",
    canonical: "https://fvf-viewer.com/faq/",
    slug: "faq",
    navLabel: "FAQ",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ_ITEMS.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answerText,
        },
      })),
    },
  },
  renderContent: () => `
    <article>
      <span class="hero-badge">Help &amp; Guidance • Frequently Asked Questions</span>
      <h1>Frequently Asked Questions</h1>
      <p class="lead">
        Find answers to common questions about FVF Viewer, including our 100% client-side privacy model, screen and browser requirements, export capabilities, error diagnostics, and sample testing.
      </p>

      <div class="faq-list">
        ${FAQ_ITEMS.map(
          (item) => `
        <div class="faq-item">
          <h2>${item.question}</h2>
          ${item.answerHtml}
        </div>`,
        ).join("\n")}
      </div>

      <div class="cta-section">
        <h3>Ready to Open Your ScopeMeter Waveforms?</h3>
        <p>
          Open, inspect, and analyze your <code>.fvf</code> captures directly in your browser with 100% privacy and zero server uploads.
        </p>
        <a href="/" class="btn-primary">Open the viewer</a>
      </div>
    </article>
  `,
};
