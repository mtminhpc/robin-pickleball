export interface ScheduledAtResult {
  value: number | null;
  error: string | null;
}

/** Ghép giá trị native `date` + `time` theo múi giờ của thiết bị đang tạo buổi. */
export function scheduledAtFromInputs(
  dateValue: string,
  timeValue: string,
): ScheduledAtResult {
  if (!dateValue && !timeValue) return { value: null, error: null };
  if (!dateValue || !timeValue) {
    return {
      value: null,
      error: "Hãy nhập đủ cả giờ bắt đầu và ngày diễn ra, hoặc để trống cả hai.",
    };
  }

  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const time = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!date || !time) return { value: null, error: "Ngày hoặc giờ không hợp lệ." };

  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (
    year < 2020 ||
    year > 2099 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return { value: null, error: "Ngày hoặc giờ không hợp lệ." };
  }

  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    local.getFullYear() !== year ||
    local.getMonth() !== month - 1 ||
    local.getDate() !== day ||
    local.getHours() !== hour ||
    local.getMinutes() !== minute
  ) {
    return { value: null, error: "Ngày hoặc giờ không hợp lệ." };
  }

  return { value: local.getTime(), error: null };
}
