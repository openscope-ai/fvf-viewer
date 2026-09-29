/**
 * Canvas fingerprinting protection (LibreWolf / RFP) detector (issue #84).
 *
 * Privacy-hardened browsers (LibreWolf, Firefox with privacy.resistFingerprinting,
 * Brave strict shields) silently spoof canvas readback (getImageData, toBlob, toDataURL)
 * with a repeating dummy noise pattern with semi-transparent alpha unless permission
 * is granted by the user in the address bar.
 *
 * This canary performs an on-demand 2x2 solid test render to check whether
 * the returned pixels match authored values exactly without triggering premature
 * permission prompts on page load.
 */

let overrideTester: (() => boolean) | null = null;

export function setCanvasReadbackOverride(
  tester: (() => boolean) | null,
): void {
  overrideTester = tester;
}

export function isCanvasReadbackAllowed(
  canvasOverride?: HTMLCanvasElement,
): boolean {
  if (overrideTester !== null) {
    return overrideTester();
  }
  try {
    const canvas = canvasOverride ?? document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;

    // Fill with a specific solid opaque color
    ctx.fillStyle = "rgb(18, 52, 86)";
    ctx.fillRect(0, 0, 2, 2);

    const imgData = ctx.getImageData(0, 0, 2, 2);
    const pixels = imgData.data;

    // In RFP / poisoned environments:
    // 1. Alpha values are spoofed with semi-transparent noise (24 <= alpha <= 162)
    // 2. RGB values deviate from the authored rgb(18, 52, 86)
    if (pixels.length < 16) return false;

    for (let i = 0; i < 16; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];

      if (r !== 18 || g !== 52 || b !== 86 || a !== 255) {
        return false;
      }
    }

    return true;
  } catch {
    // SecurityError or any canvas access failure implies blocked extraction
    return false;
  }
}

export async function verifyCanvasReadback(
  canvasOverride?: HTMLCanvasElement,
): Promise<boolean> {
  return isCanvasReadbackAllowed(canvasOverride);
}
