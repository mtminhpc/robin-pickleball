/** Chừa biên dưới giới hạn 50.000 ký tự của một ô Google Sheets. */
export const EVENT_ASSET_MAX_CHARS = 45_000;
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
  if (bytes.length < 12 || !magicMatches(mime, bytes)) return null;
  return { mime, dataUri: input };
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
