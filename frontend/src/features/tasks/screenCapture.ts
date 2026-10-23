/**
 * "Screenshot of this screen" in the Sonic panel (SPEC-tasks-12 FR-8): one frame of the current tab through the
 * browser's own screen-capture prompt, cropped to the widget being asked about, as a PNG file for the composer.
 * No library: getDisplayMedia, a video element and a canvas. The capture stops as soon as the frame is taken.
 */

export function canCaptureScreen(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Where `element` sits in a captured frame of `frameW`×`frameH`, when the frame is this tab's viewport
 * (`viewW`×`viewH`). A frame of another shape is a different window or screen, so nothing is cropped.
 */
export function cropRect(frameW: number, frameH: number, viewW: number, viewH: number, element: { left: number; top: number; width: number; height: number } | null): Rect | null {
  if (!element || element.width <= 0 || element.height <= 0 || !frameW || !frameH || !viewW || !viewH) return null;
  if (Math.abs(frameW / frameH - viewW / viewH) > 0.03) return null;
  const scale = frameW / viewW;
  const x = Math.max(0, Math.floor(element.left * scale));
  const y = Math.max(0, Math.floor(element.top * scale));
  const width = Math.min(frameW - x, Math.ceil(element.width * scale));
  const height = Math.min(frameH - y, Math.ceil(element.height * scale));
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Why a capture failed, as a sentence for the composer. */
export function captureProblem(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "AbortError") return "Screenshot not taken: screen capture was cancelled or blocked.";
  return `Screenshot not taken: ${error instanceof Error ? error.message : "the browser could not capture the screen"}.`;
}

export async function captureScreen({ element = null }: { element?: Element | null } = {}): Promise<File> {
  // preferCurrentTab and selfBrowserSurface are Chrome options; other browsers ignore them and ask which tab.
  const options = { video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" } as DisplayMediaStreamOptions;
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  try {
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    await video.play();
    // The first frame can be blank until the next paint.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const frameW = video.videoWidth; const frameH = video.videoHeight;
    if (!frameW || !frameH) throw new Error("the capture had no picture");
    const crop = cropRect(frameW, frameH, window.innerWidth, window.innerHeight, element?.getBoundingClientRect() ?? null) ?? { x: 0, y: 0, width: frameW, height: frameH };
    const canvas = document.createElement("canvas");
    canvas.width = crop.width; canvas.height = crop.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("the browser could not draw the picture");
    context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("the picture could not be saved");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return new File([blob], `screenshot-${stamp}.png`, { type: "image/png" });
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
