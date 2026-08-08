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
 * Danh tính thành viên bám theo `deviceId`, và bám thêm `userId` khi người đó đã
 * đăng nhập. Hai đường song song chứ không thay thế nhau: người ra sân không
 * đăng nhập vẫn được nhận ra qua máy như cũ, người đã đăng nhập thì được nhận ra
 * trên mọi máy.
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
  /** Tài khoản Google. Trống với người chưa đăng nhập bao giờ — phần lớn là vậy. */
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

/**
 * Thành viên ứng với một tài khoản.
 *
 * Đây là thứ khiến việc đăng nhập đáng bỏ công: mở câu lạc bộ trên cái điện
 * thoại mới mua vẫn thấy tên mình sẵn đó, không phải xin mã mời lần nữa.
 */
export function memberForUser(
  members: ClubMember[],
  userId: string,
): ClubMember | null {
  if (!userId) return null;
  return members.find((m) => m.status === "active" && m.userId === userId) ?? null;
}

/**
 * `ownerRef` của một câu lạc bộ đã thuộc về tài khoản.
 *
 * Có tiền tố `u:` để phân biệt với mã thiết bị. Cả hai đều là UUID nên nhìn vào
 * chuỗi trần không đoán ra được, mà đoán sai ở đây nghĩa là trao quyền chủ câu
 * lạc bộ cho nhầm người.
 */
export function ownerRefForUser(userId: string): string {
  return `u:${userId}`;
}

/**
 * Ai là chủ câu lạc bộ.
 *
 * Nhận cả hai dạng `ownerRef` vì dữ liệu cũ mang mã thiết bị còn dữ liệu sau khi
 * chủ câu lạc bộ đăng nhập thì mang mã tài khoản. Không có chỗ này thì đúng vào
 * lúc đăng nhập, người ta mất quyền với câu lạc bộ của chính mình.
 */
export function isClubOwner(
  club: Pick<Club, "ownerRef">,
  who: { deviceId?: string; userId?: string | null },
): boolean {
  if (who.deviceId && club.ownerRef === who.deviceId) return true;
  if (who.userId && club.ownerRef === ownerRefForUser(who.userId)) return true;
  return false;
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
