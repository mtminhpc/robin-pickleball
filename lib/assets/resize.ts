/** Thu nhỏ logo/cúp theo contain 128×128, giữ nền trong suốt. */
export async function shrinkEventAsset(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml" || file.type === "image/gif") {
    throw new Error("Chỉ nhận ảnh PNG, JPG hoặc WebP tĩnh.");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trình duyệt không xử lý được ảnh.");
    context.clearRect(0, 0, 128, 128);
    const scale = Math.min(128 / bitmap.width, 128 / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    context.drawImage(bitmap, Math.floor((128 - width) / 2), Math.floor((128 - height) / 2), width, height);
    for (const quality of [0.82, 0.62]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (!blob) continue;
      const uri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Không đọc được ảnh."));
        reader.readAsDataURL(blob);
      });
      if (uri.length <= 45_000) return uri;
    }
    throw new Error("Ảnh vẫn quá nặng sau khi thu nhỏ.");
  } finally {
    bitmap.close?.();
  }
}
