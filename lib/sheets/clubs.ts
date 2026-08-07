/**
 * Kho dữ liệu câu lạc bộ.
 *
 * Cố ý đơn giản hơn hẳn `EventRepo`, và đó là quyết định chứ không phải cắt xén.
 * Sự kiện cần nhật ký chỉ-ghi-thêm vì hai mươi người cùng nhập điểm giữa sân,
 * mất một dòng là mất một kết quả có thật. Câu lạc bộ thì mỗi tháng đổi vài lần,
 * gần như chỉ chủ sân đụng tới. Dựng cả bộ máy phát lại nhật ký ở đây chỉ tổ
 * nặng nề mà không mua thêm được gì.
 *
 * Điều duy nhất bắt buộc phải giữ là **thêm thành viên thì không được mất**, kể
 * cả khi năm người cùng quét mã vào một lúc. Cái đó có sẵn: mỗi lần vào là một
 * dòng nối thêm, mà nối thêm dòng thì Google Sheet không bao giờ đánh mất.
 *
 * Đổi tên hoặc gỡ thành viên thì ghi đè ô, tức là ai ghi sau thắng. Chấp nhận
 * được vì hai người hiếm khi cùng sửa một thành viên trong một giây, và hậu quả
 * nặng nhất là một cái tên phải sửa lại.
 */

import { randomUUID } from "node:crypto";
import {
  DEFAULT_CLUB_SETTINGS,
  type Club,
  type ClubId,
  type ClubMember,
  type ClubSettings,
  type MemberId,
} from "../domain/club";
import { generateEventCode } from "../auth/passwords";
import type { SheetsClient } from "./client";
import { indexToColumn, rowRange } from "./client";
import { HEADERS, TABS } from "./schema";

const CLUB_COLUMNS = HEADERS[TABS.clubs];
const MEMBER_COLUMNS = HEADERS[TABS.clubMembers];

const C = Object.fromEntries(CLUB_COLUMNS.map((n, i) => [n, i])) as Record<
  (typeof CLUB_COLUMNS)[number],
  number
>;
const M = Object.fromEntries(MEMBER_COLUMNS.map((n, i) => [n, i])) as Record<
  (typeof MEMBER_COLUMNS)[number],
  number
>;

export interface LoadedClub {
  club: Club;
  members: ClubMember[];
}

export class ClubRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async bootstrap(): Promise<void> {
    await this.sheets.ensureTab(TABS.clubs, HEADERS[TABS.clubs]);
    await this.sheets.ensureTab(TABS.clubMembers, HEADERS[TABS.clubMembers]);
  }

  /**
   * Đọc câu lạc bộ kèm danh bạ bằng đúng MỘT lời gọi.
   *
   * Hai dải ô đi chung một `batchGet` — hạn mức Sheets là 60 request mỗi phút cho
   * cả tài khoản dịch vụ nên tách làm hai là phí một nửa.
   */
  async load(clubId: ClubId): Promise<LoadedClub | null> {
    const [clubRows, memberRows] = await this.readAll();
    const found = clubRows.find((row, i) => i > 0 && row[C.club_id] === clubId);
    if (!found) return null;
    return { club: toClub(found), members: membersOf(memberRows, clubId) };
  }

  /** Tìm bằng mã mời, để người quét mã QR không phải biết `clubId` là gì. */
  async byInviteCode(inviteCode: string): Promise<LoadedClub | null> {
    const wanted = inviteCode.trim().toUpperCase();
    if (!wanted) return null;
    const [clubRows, memberRows] = await this.readAll();
    const found = clubRows.find(
      (row, i) => i > 0 && (row[C.invite_code] ?? "").toUpperCase() === wanted,
    );
    if (!found) return null;
    const club = toClub(found);
    return { club, members: membersOf(memberRows, club.id) };
  }

  /** Các câu lạc bộ mà một thiết bị là thành viên. */
  async forDevice(deviceId: string): Promise<Club[]> {
    if (!deviceId) return [];
    const [clubRows, memberRows] = await this.readAll();
    const mine = new Set(
      memberRows
        .filter(
          (row, i) =>
            i > 0 && row[M.device_id] === deviceId && row[M.status] === "active",
        )
        .map((row) => row[M.club_id]),
    );
    return clubRows
      .filter((row, i) => i > 0 && mine.has(row[C.club_id]))
      .map(toClub);
  }

  /**
   * Tạo câu lạc bộ, và ghi luôn người tạo thành thành viên đầu tiên.
   *
   * Gộp hai việc vào một lô: câu lạc bộ không có ai bên trong là trạng thái vô
   * nghĩa, và nếu lời gọi thứ hai hỏng thì người dùng sẽ nhìn thấy đúng thứ vô
   * nghĩa đó.
   */
  async create(input: {
    name: string;
    ownerRef: string;
    ownerName: string;
    ownerAvatarId: string;
    settings?: Partial<ClubSettings>;
    at: number;
  }): Promise<LoadedClub> {
    await this.bootstrap();

    const club: Club = {
      id: randomUUID(),
      name: input.name.trim(),
      ownerRef: input.ownerRef,
      inviteCode: await this.pickUnusedInviteCode(),
      createdAt: input.at,
      settings: { ...DEFAULT_CLUB_SETTINGS, ...input.settings },
    };
    const owner: ClubMember = {
      clubId: club.id,
      memberId: randomUUID(),
      displayName: input.ownerName.trim(),
      avatarId: input.ownerAvatarId,
      userId: "",
      deviceId: input.ownerRef,
      joinedAt: input.at,
      status: "active",
    };

    await this.sheets.batch([
      { kind: "append", tab: TABS.clubs, values: [clubRow(club)] },
      { kind: "append", tab: TABS.clubMembers, values: [memberRow(owner)] },
    ]);
    return { club, members: [owner] };
  }

  /**
   * Thêm một người vào danh bạ.
   *
   * Trả lại thành viên cũ nếu thiết bị đó đã ở trong câu lạc bộ, thay vì tạo bản
   * sao. Người ta bấm hai lần, mở lại đường dẫn cũ, quét lại mã QR — mà mỗi lần
   * lại mọc thêm một "Nam" nữa trong danh bạ thì danh bạ hỏng rất nhanh.
   */
  async addMember(
    clubId: ClubId,
    seed: {
      displayName: string;
      avatarId: string;
      deviceId: string;
      userId?: string;
    },
    at: number,
  ): Promise<ClubMember> {
    const [, memberRows] = await this.readAll();
    const existing = memberRows.find(
      (row, i) =>
        i > 0 &&
        row[M.club_id] === clubId &&
        row[M.status] === "active" &&
        seed.deviceId !== "" &&
        row[M.device_id] === seed.deviceId,
    );
    if (existing) return toMember(existing);

    const member: ClubMember = {
      clubId,
      memberId: randomUUID(),
      displayName: seed.displayName.trim(),
      avatarId: seed.avatarId,
      userId: seed.userId ?? "",
      deviceId: seed.deviceId,
      joinedAt: at,
      status: "active",
    };
    await this.sheets.batch([
      { kind: "append", tab: TABS.clubMembers, values: [memberRow(member)] },
    ]);
    return member;
  }

  /** Sửa tên hoặc ảnh đại diện của một thành viên. */
  async updateMember(
    clubId: ClubId,
    memberId: MemberId,
    patch: Partial<Pick<ClubMember, "displayName" | "avatarId" | "status">>,
  ): Promise<ClubMember | null> {
    const [, memberRows] = await this.readAll();
    const rowIndex = memberRows.findIndex(
      (row, i) =>
        i > 0 && row[M.club_id] === clubId && row[M.member_id] === memberId,
    );
    if (rowIndex === -1) return null;

    const updated: ClubMember = { ...toMember(memberRows[rowIndex]!), ...patch };
    if (patch.displayName !== undefined) {
      updated.displayName = patch.displayName.trim();
    }
    await this.sheets.batch([
      {
        kind: "update",
        range: rowRange(TABS.clubMembers, rowIndex, MEMBER_COLUMNS.length),
        values: [memberRow(updated)],
      },
    ]);
    return updated;
  }

  /** Gỡ khỏi danh bạ. Giữ lại dòng để lịch sử các buổi cũ không bị mất tên. */
  async removeMember(clubId: ClubId, memberId: MemberId): Promise<boolean> {
    const out = await this.updateMember(clubId, memberId, { status: "removed" });
    return out !== null;
  }

  /** Đổi tên hoặc cấu hình mặc định. */
  async updateClub(
    clubId: ClubId,
    patch: Partial<Pick<Club, "name" | "settings">>,
  ): Promise<Club | null> {
    const [clubRows] = await this.readAll();
    const rowIndex = clubRows.findIndex(
      (row, i) => i > 0 && row[C.club_id] === clubId,
    );
    if (rowIndex === -1) return null;

    const updated: Club = { ...toClub(clubRows[rowIndex]!), ...patch };
    if (patch.name !== undefined) updated.name = patch.name.trim();
    await this.sheets.batch([
      {
        kind: "update",
        range: rowRange(TABS.clubs, rowIndex, CLUB_COLUMNS.length),
        values: [clubRow(updated)],
      },
    ]);
    return updated;
  }

  // -- nội bộ ---------------------------------------------------------------

  private async readAll(): Promise<[string[][], string[][]]> {
    const [clubs, members] = await this.sheets.batchGet([
      `${TABS.clubs}!A:${indexToColumn(CLUB_COLUMNS.length - 1)}`,
      `${TABS.clubMembers}!A:${indexToColumn(MEMBER_COLUMNS.length - 1)}`,
    ]);
    return [clubs?.values ?? [], members?.values ?? []];
  }

  /**
   * Mã mời chưa ai dùng.
   *
   * Không gian mã đủ lớn để va chạm gần như không xảy ra, nhưng "gần như" vẫn là
   * có — và một mã trùng nghĩa là người quét mã rơi vào nhầm câu lạc bộ.
   */
  private async pickUnusedInviteCode(): Promise<string> {
    const [clubRows] = await this.readAll();
    const used = new Set(
      clubRows.slice(1).map((row) => (row[C.invite_code] ?? "").toUpperCase()),
    );
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateEventCode();
      if (!used.has(code)) return code;
    }
    throw new Error("Không sinh được mã mời mới. Thử lại sau.");
  }
}

// ---------------------------------------------------------------------------

function membersOf(rows: string[][], clubId: ClubId): ClubMember[] {
  return rows
    .filter((row, i) => i > 0 && row[M.club_id] === clubId)
    .map(toMember);
}

function toClub(row: string[]): Club {
  return {
    id: row[C.club_id] ?? "",
    name: row[C.name] ?? "",
    ownerRef: row[C.owner_ref] ?? "",
    inviteCode: row[C.invite_code] ?? "",
    createdAt: Number(row[C.created_at] ?? 0),
    settings: parseSettings(row[C.settings_json]),
  };
}

function clubRow(club: Club): string[] {
  const row = new Array<string>(CLUB_COLUMNS.length).fill("");
  row[C.club_id] = club.id;
  row[C.name] = club.name;
  row[C.owner_ref] = club.ownerRef;
  row[C.invite_code] = club.inviteCode;
  row[C.created_at] = String(club.createdAt);
  row[C.settings_json] = JSON.stringify(club.settings);
  return row;
}

function toMember(row: string[]): ClubMember {
  return {
    clubId: row[M.club_id] ?? "",
    memberId: row[M.member_id] ?? "",
    displayName: row[M.display_name] ?? "",
    avatarId: row[M.avatar_id] ?? "",
    userId: row[M.user_id] ?? "",
    deviceId: row[M.device_id] ?? "",
    joinedAt: Number(row[M.joined_at] ?? 0),
    status: row[M.status] === "removed" ? "removed" : "active",
  };
}

function memberRow(member: ClubMember): string[] {
  const row = new Array<string>(MEMBER_COLUMNS.length).fill("");
  row[M.club_id] = member.clubId;
  row[M.member_id] = member.memberId;
  row[M.display_name] = member.displayName;
  row[M.avatar_id] = member.avatarId;
  row[M.user_id] = member.userId;
  row[M.device_id] = member.deviceId;
  row[M.joined_at] = String(member.joinedAt);
  row[M.status] = member.status;
  return row;
}

/** Cấu hình hỏng thì lấy mặc định chứ không làm hỏng cả câu lạc bộ. */
function parseSettings(raw: string | undefined): ClubSettings {
  if (!raw) return { ...DEFAULT_CLUB_SETTINGS };
  try {
    return { ...DEFAULT_CLUB_SETTINGS, ...(JSON.parse(raw) as Partial<ClubSettings>) };
  } catch {
    return { ...DEFAULT_CLUB_SETTINGS };
  }
}
