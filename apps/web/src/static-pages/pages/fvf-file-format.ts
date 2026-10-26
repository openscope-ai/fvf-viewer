import type { StaticPageDefinition } from "../types";

export const fvfFileFormatPage: StaticPageDefinition = {
  meta: {
    title: "The .fvf File Format Technical Reference — FVF Viewer",
    description:
      "Technical breakdown of the binary .fvf (FVF) ScopeMeter waveform capture format: 8-byte signature, sector table layout, timebase grammar, sample decoding, and error taxonomy.",
    canonical: "https://fvf-viewer.com/fvf-file-format/",
    slug: "fvf-file-format",
    navLabel: "File Format",
  },
  renderContent: () => `
    <article>
      <span class="hero-badge">Technical Reference • Binary Format Specification</span>
      <h1>The .fvf File Format Technical Reference</h1>
      <p class="lead">
        Binary <strong>.fvf</strong> (FVF) files are waveform capture archives recorded by portable ScopeMeter test instruments and industrial diagnostic tools.
        This document provides a technical specification of the file layout, header signature, sector table, timebase grammar, sample decoding, and error taxonomy implemented in FVF Viewer.
      </p>

      <div class="callout">
        <p>
          <strong>Open-Source Reference Implementation:</strong>
          FVF Viewer decodes <code>.fvf</code> files using a high-performance WebAssembly engine written in Rust.
          All parsing executes entirely client-side in your browser with zero server uploads.
          Inspect the complete parser implementation in the <a href="https://github.com/openscope-ai/fvf-viewer" target="_blank" rel="noopener noreferrer">open-source GitHub repository</a>.
        </p>
      </div>

      <h2>1. Capture Header &amp; Signature Verification</h2>
      <p>
        Parsing begins by validating the file header and ensuring the file represents an authentic, supported waveform capture:
      </p>
      <ul>
        <li><strong>8-Byte Magic Prologue:</strong> Authentic captures begin with the exact 8-byte signature <code>FV.FVF\\x1a\\x00</code> (ASCII <code>FV.FVF</code> followed by control bytes <code>0x1A 0x00</code>). Files shorter than 8 bytes fail with <code>truncated_capture</code>; files containing at least 8 bytes with mismatched magic fail with <code>invalid_signature</code>, reporting all 8 detected bytes.</li>
        <li><strong>Capture Version:</strong> A 16-bit little-endian integer (<code>u16</code>) at byte offset <code>8</code> encodes the capture format version. FVF Viewer supports Version 1 (<code>0x0001</code>); alternative version tags report <code>unsupported_capture_version</code>.</li>
        <li><strong>Root Pointer &amp; Variant Tag:</strong> A 32-bit little-endian pointer (<code>u32</code>) at offset <code>0x1C</code> targets the capture variant tag. Valid waveform captures carry the 4-byte ASCII tag <code>CUR_</code>. Files storing non-waveform payloads (such as instrument settings files tagged <code>FV.FVS</code>) reject with <code>unsupported_capture_variant</code>.</li>
      </ul>

      <h2>2. Sector Table &amp; Record Architecture</h2>
      <p>
        The sector table indexes the waveform channels and locates each channel's parameter block:
      </p>
      <ul>
        <li><strong>Sector Table Anchor:</strong> A 32-bit pointer at offset <code>0x40</code> anchors the channel descriptor region. The table is verified prior to decoding.</li>
        <li><strong>Grammar-Driven Discovery:</strong> Rather than relying on fragile fixed file offsets, the parser dynamically walks the sector table, accommodating both empirical instrument captures (with 16-byte descriptors and 18-byte label slots) and synthetic reference files.</li>
        <li><strong>Contiguous Record Chain:</strong> Waveform channel records are stored contiguously from the first record through the end of the file. Each channel record follows the triple structure:
          <code>[Parameter Block (388 bytes)][Raw Payload (4 &times; N bytes)][Trailer Block (60+L bytes)]</code>.
          The trailer of the final channel record ends precisely at the end of the file.
        </li>
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

      <h2>4. Timebase Token Grammar &amp; Horizontal Sweep</h2>
      <p>
        The horizontal timebase specifies the acquisition sweep rate per horizontal division:
      </p>
      <ul>
        <li><strong>Anchored Grammar:</strong> Timebase tokens are parsed using a case-insensitive grammar:
          <code>^([0-9]+([.,][0-9]{1,6})?)\\s*(ns|us|&micro;s|ms|s|min)\\s*/\\s*div$</code>.
        </li>
        <li><strong>Decimal Normalization:</strong> Transparently normalizes both European comma decimals (e.g., <code>666,7 ns/div</code>, <code>1,333 us/div</code>) and period decimals (e.g., <code>1.333 us/div</code>).</li>
        <li><strong>Physical Range Bounds:</strong> Sweep speeds must fall within the physical instrument envelope between <strong>1.0 ns/div</strong> and <strong>120.0 s/div</strong> (2 minutes per division). Out-of-bounds rates reject with <code>invalid_timebase_range</code>.</li>
        <li><strong>Step Sequence Verification:</strong> Validates sweep mantissas against nominal hardware steps (<code>1.0</code>, <code>1.25</code>, <code>1.333</code>, <code>2.0</code>, <code>2.5</code>, <code>4.0</code>, <code>5.0</code>, <code>6.667</code>) and roll-mode values (<code>1</code>, <code>2</code>, <code>4</code>, <code>5 min/div</code>). In-range non-standard values trigger a <code>non_standard_timebase</code> warning.</li>
        <li><strong>Timestamp Reconstruction:</strong> Each channel's stored horizontal bounds (<code>t_left</code> at parameter offset +20, <code>t_right</code> at +44) reconstruct 64-bit floating point timestamps:
          <code>&Delta;t = (t_right &minus; t_left) / N</code> and <code>t_i = t_left + i &middot; &Delta;t</code>, preventing cumulative phase drift across deep sweeps.
        </li>
      </ul>

      <h2>5. Sample Value Decoding</h2>
      <p>
        Raw sample words are decoded and scaled according to channel classification:
      </p>
      <ul>
        <li><strong>Physical Analog Channels:</strong> Decoded from 32-bit signed little-endian raw integer counts multiplied by the per-channel vertical calibration scale factor:
          <code>value_i = raw_i &times; scale</code>.
        </li>
        <li><strong>Rail Saturation &amp; Overload Detection:</strong> Instrument clipping rails (raw values matching <code>i32::MAX</code>, <code>i32::MIN</code>, or <code>i32::MIN + 2</code>) are mapped directly to IEEE 754 <code>NaN</code> values, accompanied by a <code>saturated_samples</code> warning to signal out-of-range signal saturation.</li>
        <li><strong>Derived Math Channels:</strong> Converted from 32-bit fixed-point representations using exact division by <code>65536.0</code> (Q16.16 mantissa-preserving scaling).</li>
        <li><strong>Vertical Units:</strong> Preserves calibrated units including <code>V</code>, <code>mV</code>, <code>kV</code>, <code>A</code>, and <code>mA</code> from parameter block offset +312.</li>
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

      <div class="cta-box">
        <h3>Ready to Inspect Your Waveform Captures?</h3>
        <p>
          Open and analyze your <code>.fvf</code> captures directly in your browser with dual measurement cursors, pan/zoom navigation, and CSV/PNG export.
        </p>
        <a href="/" class="btn-primary">Open the viewer</a>
      </div>
    </article>
  `,
};
