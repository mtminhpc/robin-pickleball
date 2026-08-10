"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ImageEditMetadata, ImageFit } from "@/lib/assets/edit-metadata";
import {
  loadEditableImage,
  renderEditedImage,
  type ImageEditorSettings,
  type LoadedEditableImage,
} from "@/lib/assets/editor";
import { Button, Field, inputClass } from "@/components/ui";

export interface ImageEditorValue {
  image: string;
  editMetadata: ImageEditMetadata;
}

export function ImageEditor({
  label,
  defaultFit,
  shape = "square",
  required = false,
  variant = "field",
  tileLabel,
  aside,
  onChange,
}: {
  label: string;
  defaultFit: ImageFit;
  shape?: "square" | "round" | "transparent";
  required?: boolean;
  /**
   * `tile` là ô vuông nét đứt của bản thiết kế (khối "Thêm nhà tài trợ" 1h và ô
   * "Tải cúp" 2b). Nó chỉ đổi cái nút chọn tệp; phần cắt/xoay/phóng bên dưới vẫn
   * y nguyên, vì bản thiết kế không vẽ chúng nhưng người dùng thì cần.
   */
  variant?: "field" | "tile";
  tileLabel?: string;
  /** Nội dung đứng cạnh ô nét đứt — dùng cho ô tên và hàng chip chọn hạng. */
  aside?: ReactNode;
  onChange: (value: ImageEditorValue | null, error?: string) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedEditableImage | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<ImageEditorSettings>({
    fit: defaultFit,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    trim: false,
  });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastDistance = useRef<number | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => () => loaded?.bitmap.close(), [loaded]);
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void renderEditedImage(loaded, settings).then((result) => {
        if (cancelled) return;
        setPreview(result.dataUri);
        setError("");
        changeRef.current({ image: result.dataUri, editMetadata: result.metadata });
      }).catch((reason) => {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : "Không xử lý được ảnh.";
        setError(message);
        changeRef.current(null, message);
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loaded, settings]);

  const pick = async (file?: File) => {
    loaded?.bitmap.close();
    setLoaded(null);
    setPreview("");
    changeRef.current(null);
    if (!file) return;
    try {
      const next = await loadEditableImage(file);
      setSettings({ fit: defaultFit, zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, trim: false });
      setLoaded(next);
      setError("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Không đọc được ảnh.";
      setError(message);
      changeRef.current(null, message);
    }
  };

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (!before) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);
    const values = [...pointers.current.values()];
    if (values.length >= 2) {
      const distance = Math.hypot(values[0]!.x - values[1]!.x, values[0]!.y - values[1]!.y);
      if (lastDistance.current) {
        const ratio = distance / lastDistance.current;
        setSettings((current) => ({ ...current, zoom: Math.min(8, Math.max(0.25, current.zoom * ratio)) }));
      }
      lastDistance.current = distance;
    } else {
      setSettings((current) => ({
        ...current,
        offsetX: Math.min(1, Math.max(-1, current.offsetX + (next.x - before.x) / 128)),
        offsetY: Math.min(1, Math.max(-1, current.offsetY + (next.y - before.y) / 128)),
      }));
    }
  };

  return (
    <div className="space-y-3">
      {variant === "tile" ? (
        <div className="flex items-start gap-3">
          <label
            className={`relative grid size-16 flex-none cursor-pointer place-items-center overflow-hidden border border-dashed border-mute-400 bg-paper text-center ${shape === "round" ? "rounded-full" : ""}`}
          >
            {preview ? (
              <img src={preview} alt="" className="size-full object-contain" />
            ) : (
              <span className="font-display text-[10px] font-extrabold uppercase leading-tight tracking-[0.06em] text-mute-600">
                {tileLabel ?? label}
              </span>
            )}
            {/* Ô nhập vẫn nằm trong luồng và có kích thước thật — chỉ trong suốt.
                Ẩn bằng `display:none` thì trình duyệt không hiện được lỗi
                "bắt buộc" trên một ô không hiển thị. */}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={label}
              required={required && !loaded}
              onChange={(event) => void pick(event.target.files?.[0])}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          {aside && <div className="min-w-0 flex-1">{aside}</div>}
        </div>
      ) : (
        <Field label={label} hint="PNG/JPG/WebP, tối đa 10 MB. Ảnh thành phẩm 256×256.">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required={required && !loaded}
            onChange={(event) => void pick(event.target.files?.[0])}
          />
        </Field>
      )}
      {loaded && (
        <>
          <div
            className={`mx-auto grid touch-none place-items-center overflow-hidden border-2 border-ink ${shape === "transparent" ? "h-32 w-56 bg-[#151313]" : "size-56 bg-[linear-gradient(45deg,#ddd_25%,transparent_25%),linear-gradient(-45deg,#ddd_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ddd_75%),linear-gradient(-45deg,transparent_75%,#ddd_75%)] bg-[length:16px_16px]"} ${shape === "round" ? "rounded-full" : ""}`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            }}
            onPointerMove={pointerMove}
            onPointerUp={(event) => {
              pointers.current.delete(event.pointerId);
              lastDistance.current = null;
            }}
            onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
          >
            {preview && <img src={preview} alt="Xem trước vùng ảnh" className="size-full object-contain" />}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">Kiểu khung
              <select value={settings.fit} onChange={(event) => setSettings((item) => ({ ...item, fit: event.target.value as ImageFit }))} className={inputClass}>
                <option value="contain">Không cắt (contain)</option>
                <option value="cover">Lấp đầy (cover)</option>
              </select>
            </label>
            <label className="text-xs">Xoay
              <input type="range" min={-180} max={180} step={1} value={settings.rotation} onChange={(event) => setSettings((item) => ({ ...item, rotation: Number(event.target.value) }))} className="w-full" />
            </label>
            <label className="text-xs">Phóng to {settings.zoom.toFixed(2)}×
              <input type="range" min={0.25} max={4} step={0.01} value={settings.zoom} onChange={(event) => setSettings((item) => ({ ...item, zoom: Number(event.target.value) }))} className="w-full" />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={settings.trim} onChange={(event) => setSettings((item) => ({ ...item, trim: event.target.checked }))} />
              Tự gọt viền trong suốt
            </label>
          </div>
          <p className="text-[10px] text-mute-600">Kéo ảnh để đổi vị trí; dùng hai ngón để phóng to/thu nhỏ.</p>
          <Button type="button" tone="ghost" full onClick={() => setSettings({ fit: defaultFit, zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, trim: false })}>Đặt lại khung ảnh</Button>
        </>
      )}
      {error && <p className="text-sm text-accent-700">{error}</p>}
    </div>
  );
}
