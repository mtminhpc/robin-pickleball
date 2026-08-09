/** Trần sản phẩm; repository chia data URI qua 16 ô Google Sheet. */
export const EVENT_ASSET_MAX_BYTES = 512 * 1024;
export const EVENT_ASSET_MAX_CHARS = 700_000;
export const EVENT_ASSET_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type EventAssetMime = (typeof EVENT_ASSET_MIMES)[number];

export type ValidEventImage = { mime: EventAssetMime; dataUri: string };

/** Kiểm MIME lẫn magic bytes; SVG/GIF không thể lách qua bằng nhãn data URI giả. */
export function validateEventImageDataUri(input: unknown): ValidEventImage | null {
  if (typeof input !== "string" || input.length > EVENT_ASSET_MAX_CHARS) return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match) return null;
  const mime = match[1] as EventAssetMime;
  if (!EVENT_ASSET_MIMES.includes(mime)) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(match[2]!, "base64"));
  } catch {
    return null;
  }
  if (bytes.length < 12 || bytes.length > EVENT_ASSET_MAX_BYTES || !magicMatches(mime, bytes)) return null;
  const dimensions = imageDimensions(mime, bytes);
  if (!dimensions || dimensions.width !== 256 || dimensions.height !== 256) return null;
  return { mime, dataUri: input };
}

function imageDimensions(
  mime: EventAssetMime,
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (mime === "image/png") {
    if (bytes.length < 24) return null;
    return {
      width: readBe32(bytes, 16),
      height: readBe32(bytes, 20),
    };
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      if (length < 2) return null;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return {
          height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
          width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
        };
      }
      offset += 2 + length;
    }
    return null;
  }
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + readLe24(bytes, 24),
      height: 1 + readLe24(bytes, 27),
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
      height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8),
      height: 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10),
    };
  }
  return null;
}

function readBe32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset]! << 24) >>> 0) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!) >>> 0;
}

function readLe24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function magicMatches(mime: EventAssetMime, bytes: Uint8Array): boolean {
  if (mime === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte);
  }
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}
