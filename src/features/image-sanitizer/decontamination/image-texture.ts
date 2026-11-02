import * as THREE from "three";
import { MAX_TEXTURE_SIZE, PALETTE } from "./chamber-config";

/**
 * Decodes the uploaded file once, honouring EXIF orientation so the photo is
 * upright, and downsizes it for the GPU. The pixels shown are the user's own
 * and are never altered for effect.
 */
export interface PhotoTexture {
  texture: THREE.Texture;
  /** width / height of the displayed image. */
  aspect: number;
  /** False when the browser couldn't decode the format and a placeholder is shown. */
  decoded: boolean;
  dispose(): void;
}

export async function loadPhotoTexture(file: Blob, label: string): Promise<PhotoTexture> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest > MAX_TEXTURE_SIZE) {
      const scale = MAX_TEXTURE_SIZE / longest;
      const resized = await createImageBitmap(bitmap, {
        resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
        resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
        resizeQuality: "high",
      });
      bitmap.close();
      bitmap = resized;
    }
  } catch {
    bitmap?.close();
    return placeholderTexture(label);
  }

  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = THREE.SRGBColorSpace;
  // ImageBitmaps can't be flipped on upload; flip through the UV transform instead.
  texture.flipY = false;
  texture.repeat.set(1, -1);
  texture.offset.set(0, 1);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const owned = bitmap;
  return {
    texture,
    aspect: owned.width / owned.height,
    decoded: true,
    dispose() {
      texture.dispose();
      owned.close();
    },
  };
}

/** Neutral card for formats the browser can't preview (TIFF, HEIC in most browsers). */
export function placeholderTexture(label: string): PhotoTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const c = canvas.getContext("2d")!;
  const bg = c.createLinearGradient(0, 0, 640, 480);
  bg.addColorStop(0, PALETTE.stage);
  bg.addColorStop(1, PALETTE.metalLight);
  c.fillStyle = bg;
  c.fillRect(0, 0, 640, 480);

  c.strokeStyle = PALETTE.muted;
  c.lineWidth = 10;
  c.lineJoin = "round";
  c.strokeRect(250, 160, 140, 110);
  c.beginPath();
  c.moveTo(262, 255);
  c.lineTo(305, 210);
  c.lineTo(335, 238);
  c.lineTo(352, 222);
  c.lineTo(378, 255);
  c.stroke();
  c.fillStyle = PALETTE.muted;
  c.beginPath();
  c.arc(355, 192, 11, 0, Math.PI * 2);
  c.fill();

  c.font = "600 28px system-ui, sans-serif";
  c.textAlign = "center";
  c.fillText("Preview not available", 320, 330);
  c.font = "22px system-ui, sans-serif";
  c.fillStyle = PALETTE.accent;
  c.fillText(label, 320, 368);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: 4 / 3, decoded: false, dispose: () => texture.dispose() };
}

/**
 * Procedural "sample photo" shown in the idle chamber: a calm mint landscape
 * with a few abstract metadata tags. Purely illustrative.
 */
export function sampleTexture(): PhotoTexture {
  const w = 640;
  const h = 480;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#E6FFB0");
  sky.addColorStop(1, "#8FCF2A");
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(255,255,255,0.9)";
  c.beginPath();
  c.arc(w * 0.72, h * 0.3, 42, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#4C8A12";
  c.beginPath();
  c.moveTo(0, h);
  c.lineTo(w * 0.28, h * 0.52);
  c.lineTo(w * 0.5, h * 0.78);
  c.lineTo(w * 0.72, h * 0.56);
  c.lineTo(w, h);
  c.fill();
  c.fillStyle = "#2F5E08";
  c.beginPath();
  c.moveTo(0, h);
  c.lineTo(w * 0.18, h * 0.74);
  c.lineTo(w * 0.42, h);
  c.fill();
  [96, 150, 120].forEach((tw, i) => {
    c.fillStyle = "rgba(8, 18, 4, 0.55)";
    c.beginPath();
    c.roundRect(28, 28 + i * 34, tw, 20, 10);
    c.fill();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: w / h, decoded: false, dispose: () => texture.dispose() };
}

/** Fits an aspect ratio inside the chamber's photo box without cropping. */
export function fitPhoto(aspect: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  return safe > maxWidth / maxHeight
    ? { width: maxWidth, height: maxWidth / safe }
    : { width: maxHeight * safe, height: maxHeight };
}
