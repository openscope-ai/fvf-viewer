import type { StaticPageDefinition } from "../types";

export const openFvfFilePage: StaticPageDefinition = {
  meta: {
    title: "How to Open a .fvf File in Your Browser — FVF Viewer",
    description:
      "Open, inspect, and analyze .fvf waveform capture files from ScopeMeter instruments directly in your browser. 100% client-side privacy with zero server uploads.",
    canonical: "https://fvf-viewer.com/open-fvf-file/",
    slug: "open-fvf-file",
    navLabel: "Open FVF File",
  },
  renderContent: () => `
    <article>
      <span class="hero-badge">Guide • 100% Client-Side Privacy</span>
      <h1>How to Open a .fvf File in Your Browser</h1>
      <p class="lead">
        A <strong>.fvf</strong> (FVF) file is a binary waveform capture recorded by portable ScopeMeter test instruments.
        FVF Viewer enables you to open, display, and measure these captures directly in modern web browsers without installing desktop software, configuring drivers, or uploading sensitive capture bytes to external servers.
      </p>

      <h2>What is a .fvf File?</h2>
      <p>
        ScopeMeter handheld oscilloscopes and industrial test tools record waveform traces and instrument setups to compact binary files with the <code>.fvf</code> extension.
        Each valid file begins with the signature bytes <code>FV.FVF</code> followed by binary records encoding:
      </p>
      <ul>
        <li><strong>Header and Instrument Descriptors:</strong> Instrument model numbers, firmware configuration, and acquisition timestamps.</li>
        <li><strong>Channel Settings:</strong> Vertical sensitivity (voltage or current scaling), probe attenuation, channel labels (e.g., Input A, Input B, or German <code>Eingang A</code>), and canonical SI units.</li>
        <li><strong>Timebase Metadata:</strong> Horizontal time-per-division settings spanning nanoseconds, microseconds, milliseconds, seconds, or minutes per division.</li>
        <li><strong>Sample Payloads:</strong> Stored raw sample sequences — typically 500 up to 250,000 points per channel — encoded as fixed-point integers.</li>
      </ul>

      <h2>How to Open a .fvf File in FVF Viewer</h2>
      <div class="step-grid">
        <div class="step-card">
          <span class="step-number">Step 1</span>
          <div class="step-title">Launch the Viewer</div>
          <p class="step-desc">
            Navigate to the main viewer workspace at <a href="/">/</a> by clicking the "Open the viewer" button.
          </p>
        </div>
        <div class="step-card">
          <span class="step-number">Step 2</span>
          <div class="step-title">Load Your Capture</div>
          <p class="step-desc">
            Drag and drop your <code>.fvf</code> file onto the drop zone, or click to pick a file from your disk. You can also explore with the built-in synthetic demo capture.
          </p>
        </div>
        <div class="step-card">
          <span class="step-number">Step 3</span>
          <div class="step-title">Inspect & Measure</div>
          <p class="step-desc">
            Examine channels on the 60 FPS multi-channel canvas, zoom into transients, place measurement cursors for &Delta;t and amplitude deltas, and export CSV or PNG files.
          </p>
        </div>
      </div>

      <h2>100% Client-Side Privacy: Nothing Is Ever Uploaded</h2>
      <div class="callout">
        <div class="callout-title">Zero Network Transmission of Waveform Data</div>
        <p>
          Unlike cloud analytics services, FVF Viewer never uploads your waveform captures to a remote server.
          The proprietary binary file is parsed entirely inside your browser's memory using a high-performance WebAssembly (Rust/Wasm) engine running within an isolated Web Worker.
          Your engineering signals, proprietary equipment traces, and measurement records remain strictly on your local machine.
        </p>
      </div>

      <h2>Key Features of FVF Viewer</h2>
      <ul>
        <li><strong>High-Performance Multi-Channel Display:</strong> Smooth 60 FPS interactive waveform canvas powered by uPlot with support for simultaneous multi-channel records.</li>
        <li><strong>Adaptive Zoom and Pan:</strong> Box-zoom into signal glitches, pan through long records, and review viewport history.</li>
        <li><strong>Dual Measurement Cursors:</strong> Snapping cursors with live readouts for &Delta;t, frequency (1/&Delta;t), and per-channel voltage differentials.</li>
        <li><strong>Lossless Data Export:</strong> Export the complete sample table with full metadata headers to CSV, or capture high-resolution PNG screenshots.</li>
        <li><strong>Robust Format Decoding:</strong> Built-in tolerance for English and German localized headers, comma-decimal timebases, unaligned payload offsets, and non-sequential channel sets.</li>
      </ul>

      <div class="cta-section">
        <h3>Ready to inspect your ScopeMeter capture?</h3>
        <p>No installation, account creation, or plugins required. Open your .fvf file in seconds.</p>
        <a href="/" class="btn-primary">Open the viewer</a>
      </div>
    </article>
  `,
};
