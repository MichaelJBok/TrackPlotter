import type { BackgroundImage } from "./types";

/** Matches "<tag>_bg.png", "<tag>_bg.jpg", or "<tag>_bg_<W>x<H>.jpg" (the
 * dimension suffix lets a downscaled export still report the original video
 * frame's resolution, which is what the tracks' pixel coordinates are in). */
const BG_FILENAME_RE = /^(.*)_bg(?:_(\d+)x(\d+))?\.(png|jpe?g)$/i;

export function backgroundImageTag(filename: string): string | null {
  const m = BG_FILENAME_RE.exec(filename);
  return m ? m[1] : null;
}

function loadNaturalSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = url;
  });
}

/** Loads a background-image file into a BackgroundImage, in the track
 * coordinate system's pixel scale (see BG_FILENAME_RE). */
export async function loadBackgroundImage(file: File): Promise<BackgroundImage> {
  const m = BG_FILENAME_RE.exec(file.name);
  const url = URL.createObjectURL(file);
  if (m && m[2] && m[3]) {
    return { url, width: Number(m[2]), height: Number(m[3]) };
  }
  const { width, height } = await loadNaturalSize(url);
  return { url, width, height };
}
