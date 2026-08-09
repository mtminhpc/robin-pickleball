export type ImageFit = "contain" | "cover";

export interface ImageEditMetadata {
  fit: ImageFit;
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  trim: boolean;
  crop: { x: number; y: number; width: number; height: number };
  output: { width: number; height: number };
}

export function validImageEditMetadata(value: unknown): value is ImageEditMetadata {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ImageEditMetadata>;
  const crop = item.crop;
  return (
    (item.fit === "contain" || item.fit === "cover") &&
    finiteIn(item.zoom, 0.25, 8) &&
    finiteIn(item.offsetX, -1, 1) &&
    finiteIn(item.offsetY, -1, 1) &&
    finiteIn(item.rotation, -180, 180) &&
    typeof item.trim === "boolean" &&
    Boolean(crop) &&
    finiteIn(crop?.x, 0, 8192) &&
    finiteIn(crop?.y, 0, 8192) &&
    finiteIn(crop?.width, 1, 8192) &&
    finiteIn(crop?.height, 1, 8192) &&
    item.output?.width === 256 &&
    item.output?.height === 256
  );
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
