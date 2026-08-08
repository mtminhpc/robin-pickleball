/**
 * Kiểm thử tầng câu lạc bộ.
 *
 * Câu lạc bộ không có nhật ký lệnh như sự kiện, nên chỗ đáng lo là khác: năm
 * người cùng quét mã vào một lúc thì có ai bị rơi mất không, và bấm hai lần thì
 * danh bạ có mọc thêm bản sao không.
 */

import { describe, expect, it } from "vitest";
import {
  activeMembers,
  checkClubName,
  checkMemberName,
  memberForDevice,
  nameIsTaken,
} from "../lib/domain/club";
import { FakeSheetsClient } from "../lib/sheets/client";
import { ClubRepo } from "../lib/sheets/clubs";

async function freshClub() {
  const sheets = new FakeSheetsClient();
  const repo = new ClubRepo(sheets);
  const created = await repo.create({
    name: "Pickleball Tối Thứ Ba",
    ownerDeviceId: "dev-owner",
    ownerName: "Chủ sân",
    ownerAvatarId: "e01-c01",
    at: 1000,
  });
  return { sheets, repo, created };
}

describe("luật câu lạc bộ", () => {
  it("chặn tên quá ngắn hoặc quá dài", () => {
    expect(checkClubName("A")).toMatch(/ít nhất 2/);
    expect(checkClubName("x".repeat(61))).toMatch(/60 ký tự/);
    expect(checkClubName("  CLB Sân Bay  ")).toBeNull();
    expect(checkMemberName("")).toMatch(/Nhập tên/);
    expect(checkMemberName("Nguyễn Văn Cường")).toBeNull();
  });

  it("nhận ra tên trùng nhưng không coi là lỗi", () => {
    const members = [
      member("m1", "Nam", "d1"),
      member("m2", "Lan", "d2"),
    ];
    expect(nameIsTaken(members, " nam ")).toBe(true);
    expect(nameIsTaken(members, "Nam", "m1"), "chính mình thì không tính là trùng").toBe(false);
    expect(nameIsTaken(members, "Hùng")).toBe(false);
  });

  it("nhận ra người quay lại bằng thiết bị cũ", () => {
    const members = [member("m1", "Nam", "d1"), member("m2", "Lan", "d2")];
    expect(memberForDevice(members, "d2")?.displayName).toBe("Lan");
    expect(memberForDevice(members, "chưa-thấy-bao-giờ")).toBeNull();
    expect(memberForDevice(members, ""), "thiết bị trống không được khớp bừa").toBeNull();
  });

  it("bỏ người đã gỡ ra khỏi danh bạ và sắp theo tên tiếng Việt", () => {
    const list = activeMembers([
      member("m1", "Ánh", "d1"),
      { ...member("m2", "Bình", "d2"), status: "removed" as const },
      member("m3", "An", "d3"),
    ]);
    expect(list.map((m) => m.displayName)).toEqual(["An", "Ánh"]);
  });
});

describe("kho câu lạc bộ", () => {
  it("tạo xong là có ngay người tạo trong danh bạ", async () => {
    const { repo, created } = await freshClub();
    expect(created.members).toHaveLength(1);
    expect(created.members[0]!.displayName).toBe("Chủ sân");

    const loaded = await repo.load(created.club.id);
    expect(loaded!.club.name).toBe("Pickleball Tối Thứ Ba");
    expect(loaded!.members).toHaveLength(1);
  });

  it("tạo câu lạc bộ chỉ tốn một lời gọi ghi", async () => {
    const sheets = new FakeSheetsClient();
    const repo = new ClubRepo(sheets);
    const before = sheets.calls.batch;
    await repo.create({
      name: "CLB",
      ownerDeviceId: "d",
      ownerName: "Tôi",
      ownerAvatarId: "e01-c01",
      at: 1,
    });
    expect(sheets.calls.batch - before).toBe(1);
  });

  it("tìm được bằng mã mời, không phân biệt hoa thường", async () => {
    const { repo, created } = await freshClub();
    const found = await repo.byInviteCode(created.club.inviteCode.toLowerCase());
    expect(found?.club.id).toBe(created.club.id);
    expect(await repo.byInviteCode("KHONGCO")).toBeNull();
    expect(await repo.byInviteCode("")).toBeNull();
  });

  it("năm người cùng vào một lúc thì không ai rơi mất", async () => {
    // Đây là điều duy nhất bắt buộc phải đúng ở tầng này. Google Sheet không có
    // giao dịch, nhưng nối thêm dòng thì không bao giờ mất — nên mỗi lần vào là
    // một dòng mới, và năm lời gọi song song vẫn phải ra đủ năm người.
    const { repo, created } = await freshClub();
    const names = ["An", "Bình", "Cường", "Dũng", "Giang"];

    await Promise.all(
      names.map((name, i) =>
        repo.addMember(
          created.club.id,
          { displayName: name, avatarId: "e01-c01", deviceId: `dev-${i}` },
          2000 + i,
        ),
      ),
    );

    const loaded = await repo.load(created.club.id);
    expect(activeMembers(loaded!.members).map((m) => m.displayName).sort()).toEqual(
      ["An", "Bình", "Chủ sân", "Cường", "Dũng", "Giang"].sort(),
    );
  });

  it("cùng một thiết bị vào lại thì không mọc thêm bản sao", async () => {
    const { repo, created } = await freshClub();
    const first = await repo.addMember(
      created.club.id,
      { displayName: "Nam", avatarId: "e01-c01", deviceId: "dev-nam" },
      2000,
    );
    const again = await repo.addMember(
      created.club.id,
      { displayName: "Nam gõ lại", avatarId: "e02-c02", deviceId: "dev-nam" },
      3000,
    );

    expect(again.memberId, "phải trả lại đúng thành viên cũ").toBe(first.memberId);
    const loaded = await repo.load(created.club.id);
    expect(activeMembers(loaded!.members)).toHaveLength(2); // chủ sân + Nam
  });

  it("thiết bị trống thì mỗi lần vào là một người khác nhau", async () => {
    // Người mở bằng trình duyệt chặn cookie sẽ không có mã thiết bị. Gộp tất cả
    // bọn họ làm một người sẽ tệ hơn nhiều so với để trùng tên.
    const { repo, created } = await freshClub();
    await repo.addMember(created.club.id, { displayName: "Khách 1", avatarId: "a", deviceId: "" }, 1);
    await repo.addMember(created.club.id, { displayName: "Khách 2", avatarId: "a", deviceId: "" }, 2);
    const loaded = await repo.load(created.club.id);
    expect(activeMembers(loaded!.members)).toHaveLength(3);
  });

  it("gỡ thành viên thì mất khỏi danh bạ nhưng dòng vẫn còn", async () => {
    const { repo, created } = await freshClub();
    const nam = await repo.addMember(
      created.club.id,
      { displayName: "Nam", avatarId: "e01-c01", deviceId: "dev-nam" },
      2000,
    );

    expect(await repo.removeMember(created.club.id, nam.memberId)).toBe(true);
    const loaded = await repo.load(created.club.id);
    expect(activeMembers(loaded!.members).map((m) => m.displayName)).toEqual(["Chủ sân"]);
    expect(
      loaded!.members.some((m) => m.memberId === nam.memberId),
      "dòng phải còn để lịch sử buổi cũ không mất tên",
    ).toBe(true);
  });

  it("gỡ xong thì thiết bị đó vào lại được như người mới", async () => {
    const { repo, created } = await freshClub();
    const nam = await repo.addMember(
      created.club.id,
      { displayName: "Nam", avatarId: "e01-c01", deviceId: "dev-nam" },
      2000,
    );
    await repo.removeMember(created.club.id, nam.memberId);

    const back = await repo.addMember(
      created.club.id,
      { displayName: "Nam", avatarId: "e01-c01", deviceId: "dev-nam" },
      4000,
    );
    expect(back.memberId).not.toBe(nam.memberId);
    expect(activeMembers((await repo.load(created.club.id))!.members)).toHaveLength(2);
  });

  it("sửa được tên và ảnh đại diện", async () => {
    const { repo, created } = await freshClub();
    const owner = created.members[0]!;
    const updated = await repo.updateMember(created.club.id, owner.memberId, {
      displayName: "  Anh Tuấn  ",
      avatarId: "e05-c03",
    });
    expect(updated!.displayName).toBe("Anh Tuấn");

    const loaded = await repo.load(created.club.id);
    expect(loaded!.members[0]!.avatarId).toBe("e05-c03");
    expect(loaded!.members, "sửa không được nhân đôi dòng").toHaveLength(1);
  });

  it("đổi tên câu lạc bộ và giữ nguyên mã mời", async () => {
    const { repo, created } = await freshClub();
    const updated = await repo.updateClub(created.club.id, { name: "CLB Sân Bay" });
    expect(updated!.name).toBe("CLB Sân Bay");
    expect(updated!.inviteCode).toBe(created.club.inviteCode);

    const loaded = await repo.load(created.club.id);
    expect(loaded!.club.name).toBe("CLB Sân Bay");
    expect(loaded!.club.settings.defaultCourts).toBe(2);
  });

  it("liệt kê được các câu lạc bộ của một thiết bị", async () => {
    const { repo, created } = await freshClub();
    const second = await repo.create({
      name: "CLB Sáng Chủ Nhật",
      ownerDeviceId: "dev-owner",
      ownerName: "Chủ sân",
      ownerAvatarId: "e01-c01",
      at: 5000,
    });
    await repo.create({
      name: "CLB người khác",
      ownerDeviceId: "dev-la",
      ownerName: "Ai đó",
      ownerAvatarId: "e01-c01",
      at: 6000,
    });

    const mine = await repo.forDevice("dev-owner");
    expect(mine.map((c) => c.id).sort()).toEqual([created.club.id, second.club.id].sort());
    expect(await repo.forDevice("")).toEqual([]);
  });

  it("mỗi câu lạc bộ một mã mời khác nhau", async () => {
    const sheets = new FakeSheetsClient();
    const repo = new ClubRepo(sheets);
    const codes = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const c = await repo.create({
        name: `CLB ${i}`,
        ownerDeviceId: `d${i}`,
        ownerName: "x",
        ownerAvatarId: "a",
        at: i,
      });
      codes.add(c.club.inviteCode);
    }
    expect(codes.size).toBe(8);
  });

  it("đổi mã mời thì mã cũ hết dùng được, danh bạ giữ nguyên", async () => {
    // Đổi mã là chặn người mới vào, KHÔNG phải đuổi người đang ở trong. Gộp hai
    // việc lại thì chủ sân bấm một nút mà mất cả nhóm.
    const { repo, created } = await freshClub();
    await repo.addMember(
      created.club.id,
      { displayName: "Lan", avatarId: "e02-c02", deviceId: "dev-lan" },
      2000,
    );
    const cu = created.club.inviteCode;

    const rotated = await repo.rotateInviteCode(created.club.id);
    expect(rotated!.inviteCode).not.toBe(cu);
    expect(rotated!.id).toBe(created.club.id);
    expect(rotated!.name).toBe(created.club.name);

    expect(await repo.byInviteCode(cu)).toBeNull();
    expect((await repo.byInviteCode(rotated!.inviteCode))?.club.id).toBe(created.club.id);

    const loaded = await repo.load(created.club.id);
    expect(loaded!.members.map((m) => m.displayName).sort()).toEqual(["Chủ sân", "Lan"]);
  });

  it("đổi mã của câu lạc bộ không tồn tại thì trả null", async () => {
    const { repo } = await freshClub();
    expect(await repo.rotateInviteCode("khong-co-that")).toBeNull();
  });

  it("trả về null cho câu lạc bộ không tồn tại", async () => {
    const { repo } = await freshClub();
    expect(await repo.load("khong-co-that")).toBeNull();
    expect(await repo.updateClub("khong-co-that", { name: "x" })).toBeNull();
    expect(await repo.removeMember("khong-co-that", "x")).toBe(false);
  });
});

function member(memberId: string, displayName: string, deviceId: string) {
  return {
    clubId: "c1",
    memberId,
    displayName,
    avatarId: "e01-c01",
    userId: "",
    deviceId,
    joinedAt: 0,
    status: "active" as const,
  };
}
