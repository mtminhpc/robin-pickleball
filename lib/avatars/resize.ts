/**
 * Thu nhỏ ảnh ngay trên máy người dùng, trước khi gửi đi.
 *
 * **Thu nhỏ trước khi gửi, không phải sau.** Ảnh chụp bằng điện thoại bây giờ
 * nặng 3–5MB. Gửi nguyên lên rồi mới xử lý nghĩa là năm megabyte bò qua sóng
 * điện thoại ở sân — và mở sẵn một đường cho ai đó làm nghẹt máy chủ bằng vài
 * tệp lớn. Nén ở đây thì cái đi qua mạng chỉ còn vài kilobyte.
 *
 * Đây là chỗ duy nhất trong dự án đụng tới `canvas`, nên nó nằm riêng một tệp.
 * Phần tính toán thuần (`coverBox`, các hằng số, phép kiểm) ở
 * [photo.ts](./photo.ts) để kiểm thử được mà không cần dựng DOM.
 */

import {
  MAX_PHOTO_CHARS,
  PHOTO_BOX,
  coverBox,
  type PhotoMime,
} from "./photo";

/** Lần nén đầu, rồi lần nén cứu vãn nếu ảnh vẫn quá khổ. */
const QUALITY = [0.72, 0.5] as const;

/**
 * Đọc một tệp người dùng chọn, trả về data URI vuông 128×128 đã nén.
 *
 * Ném lỗi kèm câu tiếng Việt hiện thẳng được lên màn hình.
 */
export async function shrinkToDataUri(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Tệp bạn chọn không phải ảnh.");
  }

  const bitmap = await loadBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_BOX;
    canvas.height = PHOTO_BOX;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt này không xử lý được ảnh.");

    const { sx, sy, size } = coverBox(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, PHOTO_BOX, PHOTO_BOX);

    for (const quality of QUALITY) {
      const blob = await encode(canvas, quality);
      const uri = await readDataUri(blob);
      if (uri.length <= MAX_PHOTO_CHARS) return uri;
    }
    throw new Error("Không nén được ảnh này đủ nhỏ. Thử một ảnh khác.");
  } finally {
    bitmap.close?.();
  }
}

/**
 * Nén canvas, ưu tiên WebP.
 *
 * Cái bẫy: `toBlob` **không** trả về `null` khi trình duyệt không biết định dạng
 * được yêu cầu — theo đặc tả nó lặng lẽ rơi về PNG. Mà PNG của một tấm ảnh chụp
 * thì nặng gấp mấy chục lần WebP, đủ để vượt trần rồi bị từ chối với một câu lỗi
 * chẳng liên quan gì tới nguyên nhân thật. Nên phải xem `blob.type` trả về là gì
 * chứ không thể tin vào tham số đã truyền vào.
 */
async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob(canvas, "image/jpeg", quality);
  if (jpeg) return jpeg;
  throw new Error("Trình duyệt này không nén được ảnh.");
}

function toBlob(
  canvas: HTMLCanvasElement,
  mime: PhotoMime,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

/**
 * Giải mã tệp thành ảnh vẽ được.
 *
 * `imageOrientation: "from-image"` là thứ giữ cho ảnh chân dung chụp bằng điện
 * thoại không bị nằm ngang: máy ảnh ghi ảnh theo chiều cảm biến rồi đính kèm một
 * thẻ EXIF bảo phải xoay. Trình duyệt cũ bỏ qua tuỳ chọn này, và đó là mức hỏng
 * chấp nhận được — ảnh nghiêng vẫn hơn là không tải lên được.
 */
async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Không mở được ảnh này. Thử ảnh JPG hoặc PNG.");
  }
}

function readDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Không đọc được tệp ảnh."));
    reader.readAsDataURL(blob);
  });
}
