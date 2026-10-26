import type { StaticPageDefinition } from "../types";

export const supportedScopemeterModelsPage: StaticPageDefinition = {
  meta: {
    title:
      "Supported ScopeMeter Models & .fvf Channel Configurations — FVF Viewer",
    description:
      "Explore supported ScopeMeter test instrument models, 1-channel to 4-channel configurations, and binary waveform envelopes compatible with FVF Viewer.",
    canonical: "https://fvf-viewer.com/supported-scopemeter-models/",
    slug: "supported-scopemeter-models",
    navLabel: "Supported Models",
  },
  renderContent: () => `
    <article>
      <span class="hero-badge">Compatibility • Instrument Envelope</span>
      <h1>Supported ScopeMeter Models &amp; Waveform Envelopes</h1>
      <p class="lead">
        FVF Viewer is engineered to parse and visualize binary <strong>.fvf</strong> (FVF) waveform captures across portable ScopeMeter test instruments.
        Check your instrument family, channel layout, and capture envelope below before opening your files.
      </p>

      <h2>Supported ScopeMeter Instrument Families</h2>
      <p>
        FVF Viewer is <strong>format- and envelope-driven rather than model-gated</strong>.
        The parser validates files by checking the binary signature (<code>FV.FVF</code>), record layout, and physical envelope parameters rather than enforcing a restrictive model-code whitelist.
        Captures from all major ScopeMeter instrument families conforming to the format are supported:
      </p>

      <div class="step-grid">
        <div class="step-card">
          <span class="step-number">2-Channel & 4-Channel</span>
          <div class="step-title">ScopeMeter 190 Series</div>
          <p class="step-desc">
            High-performance industrial oscilloscopes (2-channel and 4-channel models).
            Supports up to 4 simultaneous analog channels, deep sample records, and fast horizontal sweeps.
          </p>
        </div>
        <div class="step-card">
          <span class="step-number">Industrial 2-Channel</span>
          <div class="step-title">ScopeMeter 120B Series</div>
          <p class="step-desc">
            Compact industrial test tools.
            Supports dual-channel electromechanical captures, power harmonics, and automated bus health recordings.
          </p>
        </div>
        <div class="step-card">
          <span class="step-number">Motor Drive Analysis</span>
          <div class="step-title">ScopeMeter MDA-500 Series</div>
          <p class="step-desc">
            Motor drive analyzers.
            Supports 4-channel drive inverter, motor input, and DC bus voltage and current transient waveform files.
          </p>
        </div>
        <div class="step-card">
          <span class="step-number">Portable Oscilloscopes</span>
          <div class="step-title">ScopeMeter Classic Series</div>
          <p class="step-desc">
            Field oscilloscopes and test tools producing binary <code>.fvf</code> captures with 1 to 4 analog channels.
          </p>
        </div>
      </div>

      <h2>Supported Channel Configurations</h2>
      <p>
        ScopeMeter acquisitions record varied channel combinations depending on instrument hardware and test mode:
      </p>
      <ul>
        <li><strong>Single-Channel (1 Channel):</strong> Single input acquisitions (e.g., Channel A / <code>Input A</code> or German <code>Eingang A</code>) with maximum sample record depth.</li>
        <li><strong>Dual-Channel (2 Channels):</strong> Dual simultaneous inputs (e.g., Channels A and B) for differential timing, phase, or comparative analysis.</li>
        <li><strong>Three-Channel (3 Channels):</strong> Non-sequential physical channel subsets (e.g., Channels A, B, and D) recorded when intermediate channels are disabled.</li>
        <li><strong>Four-Channel (4 Channels):</strong> Full quad-channel captures (Channels A, B, C, and D) from 4-channel ScopeMeter and MDA instruments.</li>
        <li><strong>Derived Math Channels:</strong> Best-effort recovery and display for mathematical operator traces (e.g., <code>Math A-B</code> or German <code>Mathematik A-B</code>).</li>
      </ul>

      <h2>Technical Parser Envelope</h2>
      <p>
        FVF Viewer's Rust/WebAssembly engine decodes waveform files within the following verified technical parameters:
      </p>
      <ul>
        <li><strong>Sample Count Range:</strong> Supports captures containing from <strong>500 samples</strong> (shortened envelope) up to <strong>250,000 samples</strong> (deep memory envelope) per channel.</li>
        <li><strong>Horizontal Timebase:</strong> Validates timebase steps from <strong>1.0 ns/div</strong> up to <strong>120.0 s/div</strong> (2 min/div roll mode).</li>
        <li><strong>Localized Decimal Formats:</strong> Automatically normalizes both standard period decimals (e.g., <code>1.333 us/Div</code>) and European comma decimals (e.g., <code>1,333 us/Div</code>, <code>666,7 ns/Div</code>).</li>
        <li><strong>Channel Prefix Locales:</strong> Supports standard English (<code>Input A</code>–<code>D</code>), German (<code>Eingang A</code>–<code>D</code>), and bracketed (<code>[A-D]</code>) channel tags.</li>
        <li><strong>Timestamp Reconstruction:</strong> Precision 64-bit floating point timestamp generation (<code>t_i = t_left + i · delta_t</code>) ensuring accurate time-axis alignment without drifting.</li>
        <li><strong>Physical Channel Decoding:</strong> Decodes raw integer samples scaled by per-channel vertical calibration factors (<code>raw &times; scale</code>) with bounds-checked memory access and NaN-preserving rail saturation detection.</li>
        <li><strong>Derived Channel Decoding:</strong> Recovers math operator payloads using fixed-point integer sample decoding, accommodating non-standard parameter block offsets.</li>
      </ul>

      <div class="callout">
        <div class="callout-title">Have a ScopeMeter .fvf capture to inspect?</div>
        <p>
          You do not need to choose your model or configure channels beforehand.
          FVF Viewer automatically reads instrument descriptors, detects channel counts, and calibrates time and voltage axes on load.
        </p>
      </div>

      <div class="cta-section">
        <h3>Ready to view your waveform data?</h3>
        <p>Launch the viewer in your browser and drop your .fvf file to start analyzing.</p>
        <a href="/" class="btn-primary">Open the viewer</a>
      </div>
    </article>
  `,
};
