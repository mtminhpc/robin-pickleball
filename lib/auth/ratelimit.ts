/**
 * Chặn dò mật khẩu.
 *
 * ĐÂY LÀ HÀNG RÀO THẤP, không phải bảo mật thật. Bộ đếm nằm trong bộ nhớ của
 * từng thực thể hàm serverless, nên kẻ kiên nhẫn chỉ cần chờ Vercel khởi động
 * một thực thể mới là được đếm lại từ đầu.
 *
 * Chấp nhận được vì đây là mật khẩu chia sẻ trong một nhóm chơi với nhau, và cái
 * giá của một kho đếm dùng chung (thêm Redis, thêm tiền, thêm chỗ hỏng) không
 * xứng với thứ được bảo vệ. Ghi rõ ra đây để sau này không ai nhầm tưởng nó chắc
 * chắn hơn thực tế.
 */

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** Số lần thử còn lại trong cửa sổ hiện tại. */
  remaining: number;
  /** Còn bao nhiêu giây nữa thì được thử lại. */
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, now = Date.now()): RateLimitResult {
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: MAX_ATTEMPTS - bucket.count,
    retryAfterSeconds: 0,
  };
}

/** Nhập đúng thì xoá bộ đếm, để người gõ nhầm một lần không bị phạt tiếp. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/** Dọn các ô đã hết hạn, tránh để bản đồ phình mãi trong hàm chạy lâu. */
function sweep(now: number): void {
  if (buckets.size < 256) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Chỉ dùng trong kiểm thử. */
export function resetRateLimitsForTesting(): void {
  buckets.clear();
}
