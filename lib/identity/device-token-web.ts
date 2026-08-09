/**
 * Ký/kiểm cookie thiết bị trong middleware Edge bằng Web Crypto.
 *
 * Khuôn token giống hệt `hmac.ts`: base64url(JSON) + HMAC-SHA256. Tách tệp vì
 * middleware không được nhập `node:crypto`, còn các route Node vẫn dùng bộ HMAC
 * chung đã có của dự án.
 */

interface DeviceTokenPayload {
  v: 1;
  id: string;
}

export async function signDeviceTokenWeb(
  deviceId: string,
  secret: string,
): Promise<string> {
  const body = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ v: 1, id: deviceId } satisfies DeviceTokenPayload),
    ),
  );
  const signature = await hmac(body, secret);
  return `${body}.${encodeBase64Url(signature)}`;
}

export async function verifyDeviceTokenWeb(
  token: string | undefined,
  secret: string,
): Promise<string | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const signature = decodeBase64Url(token.slice(dot + 1));
  if (!signature) return null;

  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(body),
  );
  if (!valid) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(body) ?? new Uint8Array()),
    ) as DeviceTokenPayload;
    if (
      payload.v !== 1 ||
      typeof payload.id !== "string" ||
      payload.id.length < 8 ||
      payload.id.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(payload.id)
    ) {
      return null;
    }
    return payload.id;
  } catch {
    return null;
  }
}

async function hmac(
  body: string,
  secret: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await importKey(secret);
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
}

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function encodeBase64Url(bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      value.length + ((4 - (value.length % 4)) % 4),
      "=",
    );
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
