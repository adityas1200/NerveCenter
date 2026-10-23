import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithClient } from "@/test/utils";
import { canCaptureScreen, captureProblem, captureScreen, cropRect } from "./screenCapture";
import { TaskComposer } from "./TaskComposer";

/** SPEC-tasks-12 FR-8: "Screenshot of this screen" from the + menu, one frame, cropped to the widget asked about. */

const track = () => ({ stop: vi.fn() });

function stubCapture({ refuse = false, width = 1600, height = 900 } = {}) {
  const tracks = [track()];
  const getDisplayMedia = vi.fn(() => (refuse ? Promise.reject(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })) : Promise.resolve({ getTracks: () => tracks } as unknown as MediaStream)));
  Object.defineProperty(navigator, "mediaDevices", { value: { getDisplayMedia }, configurable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(height);
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, done: BlobCallback) { done(new Blob(["png"], { type: "image/png" })); });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
  Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 450, configurable: true });
  return { getDisplayMedia, tracks, drawImage };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("cropping to the widget", () => {
  it("scales the widget's box to the captured frame of this tab", () => {
    expect(cropRect(1600, 900, 800, 450, { left: 100, top: 50, width: 300, height: 200 })).toEqual({ x: 200, y: 100, width: 600, height: 400 });
    // Clipped at the frame's edge.
    expect(cropRect(1600, 900, 800, 450, { left: 700, top: 400, width: 300, height: 200 })).toEqual({ x: 1400, y: 800, width: 200, height: 100 });
  });

  it("does not crop a frame of another shape (another window or screen), a widget off screen, or nothing", () => {
    expect(cropRect(1920, 1200, 800, 450, { left: 100, top: 50, width: 300, height: 200 })).toBeNull();
    expect(cropRect(1600, 900, 800, 450, { left: 900, top: 50, width: 300, height: 200 })).toBeNull();
    expect(cropRect(1600, 900, 800, 450, null)).toBeNull();
  });

  it("says why a capture failed in a sentence", () => {
    expect(captureProblem(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBe("Screenshot not taken: screen capture was cancelled or blocked.");
    expect(captureProblem(new Error("the capture had no picture"))).toBe("Screenshot not taken: the capture had no picture.");
  });
});

describe("taking one frame", () => {
  it("asks the browser for the current tab, crops to the element, returns a PNG and stops the capture", async () => {
    const { getDisplayMedia, tracks, drawImage } = stubCapture();
    expect(canCaptureScreen()).toBe(true);
    const element = document.createElement("section");
    element.getBoundingClientRect = () => ({ left: 100, top: 50, width: 300, height: 200 }) as DOMRect;
    const file = await captureScreen({ element });
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true }));
    expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLVideoElement), 200, 100, 600, 400, 0, 0, 600, 400);
    expect(file.type).toBe("image/png");
    expect(file.name).toMatch(/^screenshot-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.png$/);
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it("stops the capture even when the frame cannot be read", async () => {
    const { tracks } = stubCapture({ width: 0, height: 0 });
    await expect(captureScreen()).rejects.toThrow("the capture had no picture");
    expect(tracks[0].stop).toHaveBeenCalled();
  });
});

describe("the + menu", () => {
  it("offers the screenshot only with a capture target and browser support, and attaches the PNG", async () => {
    stubCapture();
    const onSend = vi.fn(() => Promise.resolve());
    const target = document.createElement("section");
    target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 450 }) as DOMRect;
    renderWithClient(<TaskComposer attachments capture={() => target} onSend={onSend} />);
    await userEvent.click(screen.getByRole("button", { name: "Attach files" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Screenshot of this screen/ }));
    const attached = await screen.findByRole("list", { name: "Attached files" });
    expect(within(attached).getByText(/^screenshot-.*\.png$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("", [], [{ name: expect.stringMatching(/^screenshot-.*\.png$/), data: btoa("png") }]));
  });

  it("says so inline and attaches nothing when the person cancels the browser prompt", async () => {
    stubCapture({ refuse: true });
    renderWithClient(<TaskComposer attachments capture={() => null} onSend={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Attach files" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Screenshot of this screen/ }));
    expect(await screen.findByText("Screenshot not taken: screen capture was cancelled or blocked.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Attached files" })).not.toBeInTheDocument();
  });

  it("leaves the item out where the browser cannot capture, or when the page gave no capture target", async () => {
    renderWithClient(<TaskComposer attachments capture={() => null} onSend={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Attach files" }));
    expect(await screen.findByRole("menuitem", { name: /Images/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Screenshot/ })).not.toBeInTheDocument();
  });
});
