/**
 * Câu lạc bộ: danh bạ những người hay đánh cùng nhau.
 *
 * Mục đích duy nhất là **khỏi phải gõ lại tên** mỗi tuần. Một nhóm chơi cố định
 * mười lăm người mà tuần nào chủ sân cũng gõ lại mười lăm cái tên thì đó là việc
 * đáng để phần mềm làm hộ.
 *
 * Khác hẳn sự kiện, ở đây **không có nhật ký lệnh**. Sự kiện cần nhật ký vì hai
 * mươi người cùng nhập điểm giữa sân, mất một dòng là mất một kết quả. Câu lạc bộ
 * thì mỗi tháng đổi vài lần, thường chỉ chủ sân đụng tới, nên bộ máy phát lại
 * nhật ký chỉ tổ nặng nề mà không mua thêm được gì. Điều duy nhất phải giữ là
 * *thêm thành viên thì không được mất* — và cái đó có sẵn nhờ nối thêm dòng.
 *
 * Danh tính thành viên bám theo `deviceId` cho tới khi có tài khoản Google ở giai
 * đoạn sau. Đủ dùng vì gần như ai cũng dùng đúng một điện thoại ra sân.
 */

export type ClubId = string;
export type MemberId = string;

export interface ClubSettings {
  /** Số sân mặc định khi tạo buổi đánh từ câu lạc bộ này. */
  defaultCourts: number;
  /** Mốc điểm mặc định. */
  defaultPointsTo: number;
}

export const DEFAULT_CLUB_SETTINGS: ClubSettings = {
  defaultCourts: 2,
  defaultPointsTo: 11,
};

export interface Club {
  id: ClubId;
  name: string;
  /** Thiết bị hoặc tài khoản của người tạo. */
  ownerRef: string;
  /** Mã để người khác tự vào, chiếu lên hoặc nhắn cho nhau. */
  inviteCode: string;
  createdAt: number;
  settings: ClubSettings;
}

export type MemberStatus = "active" | "removed";

export interface ClubMember {
  clubId: ClubId;
  memberId: MemberId;
  displayName: string;
  avatarId: string;
  /** Tài khoản Google, để trống cho tới giai đoạn sau. */
  userId: string;
  /** Thiết bị đã nhận là mình — khoá chính trên thực tế ở giai đoạn này. */
  deviceId: string;
  joinedAt: number;
  status: MemberStatus;
}

/** Thành viên còn trong danh bạ, sắp theo tên để danh sách không nhảy lung tung. */
export function activeMembers(members: ClubMember[]): ClubMember[] {
  return members
    .filter((m) => m.status === "active")
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "vi"));
}

/**
 * Thành viên ứng với một thiết bị.
 *
 * Dùng để nhận ra người quay lại: họ mở đường dẫn câu lạc bộ trên đúng cái điện
 * thoại cũ thì phải thấy tên mình sẵn đó, không phải nhập lại.
 */
export function memberForDevice(
  members: ClubMember[],
  deviceId: string,
): ClubMember | null {
  if (!deviceId) return null;
  return (
    members.find((m) => m.status === "active" && m.deviceId === deviceId) ?? null
  );
}

/** Kiểm tên câu lạc bộ. Trả câu giải thích nếu không dùng được, `null` nếu được. */
export function checkClubName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return "Tên câu lạc bộ cần ít nhất 2 ký tự.";
  if (trimmed.length > 60) return "Tên câu lạc bộ dài quá 60 ký tự.";
  return null;
}

/** Kiểm tên thành viên. */
export function checkMemberName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1) return "Nhập tên đã.";
  if (trimmed.length > 40) return "Tên dài quá 40 ký tự.";
  return null;
}

/**
 * Tên đã có người dùng trong câu lạc bộ chưa.
 *
 * Không chặn hẳn — nhóm nào cũng có thể có hai người tên Nam — nhưng phải cảnh
 * báo, vì trùng tên giữa sân là lúc người ta nhập nhầm điểm cho nhau.
 */
export function nameIsTaken(
  members: ClubMember[],
  name: string,
  exceptMemberId?: MemberId,
): boolean {
  const wanted = name.trim().toLowerCase();
  return members.some(
    (m) =>
      m.status === "active" &&
      m.memberId !== exceptMemberId &&
      m.displayName.trim().toLowerCase() === wanted,
  );
}
