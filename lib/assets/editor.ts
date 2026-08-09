import { EVENT_ASSET_MAX_BYTES, EVENT_ASSET_MAX_CHARS } from "./event-image";
import type { ImageEditMetadata, ImageFit } from "./edit-metadata";

export interface ImageEditorSettings {
  fit: ImageFit;
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  trim: boolean;
}

export interface EditedImage {
  dataUri: string;
  metadata: ImageEditMetadata;
}

export interface LoadedEditableImage {
  bitmap: ImageBitmap;
  trimmedCrop: { x: number; y: number; width: number; height: number };
}

export async function loadEditableImage(file: File): Promise<LoadedEditableImage> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Ảnh đầu vào tối đa 10 MB.");
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Chỉ nhận ảnh PNG, JPG hoặc WebP tĩnh.");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 8192 || bitmap.height > 8192) {
    bitmap.close();
    throw new Error("Kích thước ảnh giải mã phải từ 1 đến 8192 px mỗi chiều.");
  }
  return { bitmap, trimmedCrop: findVisibleCrop(bitmap) };
}

export async function renderEditedImage(
  loaded: LoadedEditableImage,
  settings: ImageEditorSettings,
): Promise<EditedImage> {
  const size = 256;
  const crop = settings.trim
    ? loaded.trimmedCrop
    : { x: 0, y: 0, width: loaded.bitmap.width, height: loaded.bitmap.height };
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Trình duyệt không xử lý được ảnh.");
  context.clearRect(0, 0, size, size);

  const safeSize = settings.fit === "contain" ? size - 16 : size;
  const baseScale = settings.fit === "contain"
    ? Math.min(safeSize / crop.width, safeSize / crop.height)
    : Math.max(safeSize / crop.width, safeSize / crop.height);
  const scale = baseScale * clamp(settings.zoom, 0.25, 8);
  const width = crop.width * scale;
  const height = crop.height * scale;
  context.save();
  context.translate(
    size / 2 + clamp(settings.offsetX, -1, 1) * (size / 2),
    size / 2 + clamp(settings.offsetY, -1, 1) * (size / 2),
  );
  context.rotate((clamp(settings.rotation, -180, 180) * Math.PI) / 180);
  context.drawImage(
    loaded.bitmap,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    -width / 2,
    -height / 2,
    width,
    height,
  );
  context.restore();

  const dataUri = await encodeWithinSheetLimit(canvas);
  return {
    dataUri,
    metadata: {
      ...settings,
      zoom: clamp(settings.zoom, 0.25, 8),
      offsetX: clamp(settings.offsetX, -1, 1),
      offsetY: clamp(settings.offsetY, -1, 1),
      rotation: clamp(settings.rotation, -180, 180),
      crop,
      output: { width: size, height: size },
    },
  };
}

function findVisibleCrop(bitmap: ImageBitmap) {
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  context.drawImage(bitmap, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]! <= 4) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  }
  const inverse = 1 / scale;
  return {
    x: Math.max(0, Math.floor(minX * inverse)),
    y: Math.max(0, Math.floor(minY * inverse)),
    width: Math.min(bitmap.width, Math.ceil((maxX - minX + 1) * inverse)),
    height: Math.min(bitmap.height, Math.ceil((maxY - minY + 1) * inverse)),
  };
}

async function encodeWithinSheetLimit(canvas: HTMLCanvasElement): Promise<string> {
  for (const quality of [0.86, 0.72, 0.58, 0.44, 0.32]) {
    const webp = await toBlob(canvas, "image/webp", quality);
    if (webp?.type === "image/webp" && webp.size <= EVENT_ASSET_MAX_BYTES) {
      const uri = await asDataUri(webp);
      if (uri.length <= EVENT_ASSET_MAX_CHARS) return uri;
    }
  }
  const png = await toBlob(canvas, "image/png");
  if (png && png.size <= EVENT_ASSET_MAX_BYTES) {
    const uri = await asDataUri(png);
    if (uri.length <= EVENT_ASSET_MAX_CHARS) return uri;
  }
  throw new Error("Ảnh vẫn quá nặng sau khi nén. Hãy giảm chi tiết hoặc chọn ảnh khác.");
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
}

function asDataUri(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Không đọc được ảnh đã xử lý."));
    reader.readAsDataURL(blob);
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
