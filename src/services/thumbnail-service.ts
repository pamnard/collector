import type { MediaType } from "@collector/shared";

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};

const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

const COVER_MAX_EDGE = 480;
const COVER_WEBP_QUALITY = 0.85;

function extension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function mimeForFilename(filename: string, mediaType: MediaType): string {
  const ext = extension(filename);
  if (mediaType === "video") {
    return VIDEO_MIME[ext] ?? "video/mp4";
  }
  return IMAGE_MIME[ext] ?? "image/jpeg";
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image"));
    image.src = url;
  });
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode cover.webp"));
          return;
        }
        void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)));
      },
      "image/webp",
      COVER_WEBP_QUALITY,
    );
  });
}

function drawToCoverCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, COVER_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context unavailable");
  }

  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function generateCoverFromImage(
  data: Uint8Array,
  filename: string,
): Promise<Uint8Array> {
  const blob = new Blob([data], { type: mimeForFilename(filename, "image") });
  const url = URL.createObjectURL(blob);

  try {
    const image = await loadImage(url);
    const canvas = drawToCoverCanvas(image, image.naturalWidth, image.naturalHeight);
    return canvasToWebp(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function generateCoverFromVideo(
  data: Uint8Array,
  filename: string,
): Promise<Uint8Array | null> {
  const blob = new Blob([data], { type: mimeForFilename(filename, "video") });
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Failed to decode video"));
    });

    const seekTarget = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(0.5, video.duration / 2)
      : 0;

    video.currentTime = seekTarget;
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("Failed to seek video"));
    });

    const canvas = drawToCoverCanvas(video, video.videoWidth, video.videoHeight);
    return canvasToWebp(canvas);
  } catch {
    return null;
  } finally {
    video.src = "";
    URL.revokeObjectURL(url);
  }
}

export async function generateCoverFromMedia(
  data: Uint8Array,
  filename: string,
  mediaType: MediaType,
): Promise<Uint8Array | null> {
  if (mediaType === "image") {
    return generateCoverFromImage(data, filename);
  }

  if (mediaType === "video") {
    return generateCoverFromVideo(data, filename);
  }

  return null;
}
