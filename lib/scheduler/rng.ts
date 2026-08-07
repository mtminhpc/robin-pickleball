/**
 * Bộ sinh số giả ngẫu nhiên có hạt giống.
 *
 * Dùng bộ sinh riêng thay vì Math.random để hai lần chạy cùng đầu vào cho ra cùng
 * một lịch. Nhờ vậy khi ai đó thắc mắc "sao tôi lại nghỉ vòng này" thì còn dựng
 * lại được, và bộ test không bị chập chờn.
 */

export interface Rng {
  /** Số thực trong [0, 1). */
  next(): number;
  /** Số nguyên trong [0, n). */
  int(n: number): number;
  /** Chọn ngẫu nhiên một phần tử. */
  pick<T>(items: readonly T[]): T;
  /** Trộn tại chỗ (Fisher–Yates). */
  shuffle<T>(items: T[]): T[];
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      return items[int(items.length)];
    },
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
      }
      return items;
    },
  };
}

/** Hạt giống ổn định suy từ một chuỗi — cùng mã sự kiện luôn cho cùng hạt giống. */
export function seedFrom(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
