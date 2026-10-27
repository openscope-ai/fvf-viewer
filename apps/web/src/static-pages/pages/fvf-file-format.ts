import type { StaticPageDefinition } from "../types";

export const fvfFileFormatPage: StaticPageDefinition = {
  meta: {
    title: "The .fvf File Format Technical Overview — FVF Viewer",
    description:
      "Technical overview of how FVF Viewer decodes and validates ScopeMeter .fvf binary waveform captures: header validation, channel discovery, timebase ranges, sample scaling, and diagnostics.",
    canonical: "https://fvf-viewer.com/fvf-file-format/",
    slug: "fvf-file-format",
    navLabel: "File Format",
  },
  renderContent: () => `
    <article>
      <span class="hero-badge">Technical Overview • Parser &amp; Validation Reference</span>
      <h1>The .fvf File Format Technical Overview</h1>
      <p class="lead">
        Binary <strong>.fvf</strong> (FVF) files are waveform capture archives recorded by portable ScopeMeter test instruments and industrial diagnostic tools.
        This document provides an overview of how the open-source FVF Viewer parser verifies file integrity, validates horizontal and vertical parameters, decodes waveform samples, and categorizes diagnostic errors and warnings for interoperability.
      </p>

      <div class="callout">
        <div class="callout-title">Unofficial Interoperability Reference</div>
        <p>
          This technical overview is an independent, unofficial reference documenting how the open-source FVF Viewer WebAssembly engine decodes and validates <code>.fvf</code> waveform files for interoperability.
          All decoding executes entirely client-side in your browser with zero server uploads.
          This documentation is provided "as is" for diagnostic and troubleshooting purposes without warranty of completeness.
          Inspect the complete parser implementation in the <a href="https://github.com/openscope-ai/fvf-viewer" target="_blank" rel="noopener noreferrer">open-source GitHub repository</a>.
        </p>
      </div>

      <h2>1. Capture Header &amp; Signature Verification</h2>
      <p>
        Parsing begins by validating the file header and ensuring the file represents an authentic, supported waveform capture:
      </p>
      <ul>
        <li><strong>8-Byte Header Signature:</strong> The file must begin with the characteristic 8-byte ScopeMeter file header signature. Files shorter than 8 bytes fail with <code>truncated_capture</code>; files containing at least 8 bytes with an unrecognised signature fail with <code>invalid_signature</code>, reporting the detected header bytes.</li>
        <li><strong>Capture Version:</strong> The capture format version field in the header is validated. FVF Viewer supports Version 1 captures; alternative or unrecognised version numbers report <code>unsupported_capture_version</code>.</li>
        <li><strong>Waveform Variant Validation:</strong> The header pointer targets the capture variant descriptor. Valid waveform captures carry a waveform curve tag; files storing non-waveform payloads (such as instrument setup or configuration archives) are safely identified and rejected with <code>unsupported_capture_variant</code>.</li>
      </ul>

      <h2>2. Sector Table &amp; Record Architecture</h2>
      <p>
        The sector table indexes the waveform channels and locates each channel's parameter block:
      </p>
      <ul>
        <li><strong>Sector Table Validation:</strong> The parser validates the sector index table anchoring the channel descriptors before decoding. Corrupted or unreadable sector indexing halts parsing with <code>corrupt_sector_table</code>.</li>
        <li><strong>Grammar-Driven Channel Discovery:</strong> Rather than relying on fragile fixed file offsets, the parser dynamically walks the sector table, accommodating variations across empirical instrument acquisitions and synthetic test fixtures.</li>
        <li><strong>Contiguous Record Chain:</strong> Waveform channel records are stored contiguously across the capture payload. Each channel record contains a channel parameter block, a raw sample payload, and a record trailer. The parser verifies that records chain seamlessly through to the end of the file.</li>
      </ul>

      <h2>3. Channel Configurations &amp; Capture Envelope</h2>
      <p>
        The parser enforces strict envelope bounds derived from ScopeMeter instrument architecture:
      </p>
      <ul>
        <li><strong>Sample Depth Envelope:</strong> Standard physical channel acquisitions store between <strong>500</strong> (minimum envelope) and <strong>250,000</strong> (deep capture envelope) samples per channel. Counts outside this range fail validation.</li>
        <li><strong>Channel Topologies:</strong> Supports single-channel, dual-channel, non-sequential subsets (e.g., Channels A, B, and D), and full quad-channel (A, B, C, D) captures.</li>
        <li><strong>Localized Channel Prefixes:</strong> Normalizes channel labels across language localizations, including English (<code>Input A</code>–<code>D</code>), German (<code>Eingang A</code>–<code>D</code>), and bracketed notation (<code>[A-D]</code>).</li>
        <li><strong>Derived Math Channels:</strong> Best-effort recovery for mathematical channels (e.g., <code>Math</code> or <code>Mathematik A-B</code>). Deviating parameter block offsets are handled via payload marker detection without failing the physical channel decode.</li>
      </ul>

      <h2>4. Timebase Validation &amp; Horizontal Sweep</h2>
      <p>
        The horizontal timebase specifies the acquisition sweep rate per horizontal division:
      </p>
      <ul>
        <li><strong>Timebase Token Parsing:</strong> Timebase tokens are parsed from the channel header string, matching numeric sweep intervals and standard duration units (<code>ns</code>, <code>&micro;s</code>, <code>ms</code>, <code>s</code>, <code>min</code>) per division. Unparseable tokens fail with <code>invalid_timebase_format</code>.</li>
        <li><strong>Decimal Normalization:</strong> Transparently normalizes both European comma decimals (e.g., <code>666,7 ns/div</code>, <code>1,333 us/div</code>) and period decimals (e.g., <code>1.333 us/div</code>).</li>
        <li><strong>Physical Range Bounds:</strong> Sweep speeds must fall within the physical instrument envelope between <strong>1.0 ns/div</strong> and <strong>120.0 s/div</strong> (2 minutes per division). Out-of-bounds rates reject with <code>invalid_timebase_range</code>.</li>
        <li><strong>Step Sequence Verification:</strong> Validates sweep rates against nominal hardware steps (e.g., <code>1.0</code>, <code>2.0</code>, <code>5.0</code> intervals) and roll-mode values (<code>1</code>, <code>2</code>, <code>4</code>, <code>5 min/div</code>). In-range non-standard values trigger a <code>non_standard_timebase</code> warning.</li>
        <li><strong>Timestamp Reconstruction:</strong> Each channel's stored horizontal start and end bounds reconstruct uniform 64-bit floating point timestamps (&Delta;t interval spacing), preventing cumulative phase drift across deep sweeps. Invalid time axis spans report <code>invalid_time_axis</code>.</li>
      </ul>

      <h2>5. Sample Value Decoding</h2>
      <p>
        Raw sample words are decoded and scaled according to channel classification:
      </p>
      <ul>
        <li><strong>Physical Analog Channels:</strong> Decoded from signed raw integer sample words scaled by the channel's calibrated vertical scale factor into physical signal units.</li>
        <li><strong>Rail Saturation &amp; Overload Detection:</strong> Instrument clipping rails and overload saturation values are mapped directly to IEEE 754 <code>NaN</code> values, accompanied by a <code>saturated_samples</code> warning to signal out-of-range signal saturation.</li>
        <li><strong>Derived Math Channels:</strong> Converted from fixed-point representations using normalized mantissa scaling to preserve mathematical channel accuracy.</li>
        <li><strong>Vertical Units:</strong> Preserves calibrated vertical units including <code>V</code>, <code>mV</code>, <code>kV</code>, <code>A</code>, and <code>mA</code> extracted from channel metadata.</li>
      </ul>

      <h2>6. Typed Error &amp; Warning Taxonomy</h2>
      <p>
        The parser implements a formal, typed error and warning taxonomy. Errors halt parsing with deterministic diagnostics; warnings indicate non-critical deviations while allowing successful waveform visualization:
      </p>

      <div class="step-grid">
        <div class="step-card">
          <span class="step-number">Fatal Errors</span>
          <div class="step-title">FvfError Codes</div>
          <p class="step-desc">
            <code>invalid_signature</code>, <code>unsupported_capture_version</code>, <code>unsupported_capture_variant</code>, <code>truncated_capture</code>, <code>opaque_header</code>, <code>corrupt_sector_table</code>, <code>invalid_timebase_format</code>, <code>invalid_timebase_range</code>, <code>invalid_time_axis</code>.
          </p>
        </div>
        <div class="step-card">
          <span class="step-number">Non-Fatal Warnings</span>
          <div class="step-title">ParseWarning Codes</div>
          <p class="step-desc">
            <code>saturated_samples</code>, <code>non_standard_timebase</code>, <code>unknown_unit</code>, <code>vertical_metadata_mismatch</code>, <code>derived_record_issue</code>, <code>derived_legacy_values</code>, <code>time_axis_span_mismatch</code>, <code>duplicate_channel</code>, <code>unknown_tag_prefix</code>, <code>unknown_record</code>, <code>unclassified_tag</code>.
          </p>
        </div>
      </div>

      <div class="cta-section">
        <h3>Ready to Inspect Your Waveform Captures?</h3>
        <p>
          Open and analyze your <code>.fvf</code> captures directly in your browser with dual measurement cursors, pan/zoom navigation, and CSV/PNG export.
        </p>
        <a href="/" class="btn-primary">Open the viewer</a>
      </div>
    </article>
  `,
};
