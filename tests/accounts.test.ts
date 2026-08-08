/**
 * Kiểm thử tầng tài khoản.
 *
 * Ba nhóm rủi ro thật, không phải kiểm cho có:
 *
 * 1. **Cookie tài khoản.** Nó nói "cái máy này là ai", nên mọi cách làm giả phải
 *    bị chặn — hệt như đã làm với cookie phiên sự kiện.
 * 2. **Mất dữ liệu khi đăng nhập.** Đây là nỗi sợ thật: người dùng bấm nút rồi
 *    thấy lịch sử biến mất, hoặc mọc thêm một bản sao tên mình trong danh bạ.
 * 3. **`id_token`.** Nhận nhầm token của ứng dụng khác nghĩa là ai cũng đăng
 *    nhập được thành người khác.
 */

import { describe, expect, it } from "vitest";
import {
  displayNameFrom,
  mergeRecentEvents,
  normalizeEmail,
} from "../lib/domain/account";
import {
  isClubOwner,
  memberForDevice,
  memberForUser,
  ownerRefForUser,
} from "../lib/domain/club";
import { readIdentity, safeNextPath } from "../lib/auth/google-oauth";
import {
  newUserSession,
  signUserSession,
  verifyUserSession,
} from "../lib/auth/user-session";
import { verifyTransaction, signTransaction } from "../lib/auth/oauth-cookie";
import { findMyPlayer } from "../lib/api/context";
import type { EventState, Player } from "../lib/domain/types";
import { EventSim } from "../lib/testing/harness";
import { FakeSheetsClient } from "../lib/sheets/client";
import { AccountRepo } from "../lib/sheets/accounts";
import { ClubRepo } from "../lib/sheets/clubs";

const SECRET = "khoa-thu-nghiem-du-dai-16-ky-tu";

describe("cookie tài khoản", () => {
  it("ký rồi đọc lại được", () => {
    const token = signUserSession(newUserSession("u1", "a@b.com"), SECRET);
    expect(verifyUserSession(token, SECRET)?.uid).toBe("u1");
  });

  it("từ chối cookie bị sửa nội dung", () => {
    // Cách tấn công hiển nhiên nhất: đổi `uid` sang tài khoản của người khác.
    const token = signUserSession(newUserSession("u1", "a@b.com"), SECRET);
    const [body, signature] = token.split(".");
    const tampered = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body!, "base64url").toString()),
        uid: "u2",
      }),
      "utf8",
    ).toString("base64url");

    expect(verifyUserSession(`${tampered}.${signature}`, SECRET)).toBeNull();
  });

  it("từ chối cookie ký bằng khoá khác, và cookie hết hạn", () => {
    expect(
      verifyUserSession(
        signUserSession(newUserSession("u1", "a@b.com"), "khoa-khac-hoan-toan"),
        SECRET,
      ),
    ).toBeNull();

    const past = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const old = signUserSession(newUserSession("u1", "a@b.com", past), SECRET);
    expect(verifyUserSession(old, SECRET)).toBeNull();
    expect(verifyUserSession(old, SECRET, past + 1000)).not.toBeNull();
  });

  it("từ chối chuỗi rác", () => {
    expect(verifyUserSession(undefined, SECRET)).toBeNull();
    expect(verifyUserSession("", SECRET)).toBeNull();
    expect(verifyUserSession("khong-co-dau-cham", SECRET)).toBeNull();
    expect(verifyUserSession("a.b", SECRET)).toBeNull();
  });
});

describe("cookie chuyến đăng nhập", () => {
  it("giữ được state và verifier, và hết hạn sau mười phút", () => {
    const now = 1_000_000_000;
    const tx = {
      state: "s1",
      verifier: "v1",
      next: "/me",
      exp: Math.floor(now / 1000) + 600,
    };
    const token = signTransaction(tx, SECRET);

    expect(verifyTransaction(token, SECRET, now)?.verifier).toBe("v1");
    expect(verifyTransaction(token, SECRET, now + 601_000)).toBeNull();
  });

  it("chỉ nhận đường dẫn nội bộ để quay về", () => {
    // Không có bước này thì nút đăng nhập thành bàn đạp chuyển hướng cho người khác.
    expect(safeNextPath("/c/abc")).toBe("/c/abc");
    expect(safeNextPath("https://trang-gia-mao.example")).toBe("/");
    expect(safeNextPath("//trang-gia-mao.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});

describe("đọc id_token", () => {
  const CLIENT = "client-cua-chung-ta.apps.googleusercontent.com";

  function token(claims: Record<string, unknown>): string {
    const part = (o: unknown) =>
      Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
    return `${part({ alg: "RS256" })}.${part(claims)}.chu-ky-khong-doc-o-day`;
  }

  const valid = {
    aud: CLIENT,
    iss: "https://accounts.google.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "Nam@Example.COM",
    email_verified: true,
    name: "Nguyễn Nam",
  };

  it("lấy ra email đã chuẩn hoá và tên", () => {
    const identity = readIdentity(token(valid), CLIENT);
    expect(identity.email).toBe("nam@example.com");
    expect(identity.displayName).toBe("Nguyễn Nam");
  });

  it("từ chối token cấp cho ứng dụng khác", () => {
    expect(() => readIdentity(token({ ...valid, aud: "ung-dung-khac" }), CLIENT)).toThrow(
      /ứng dụng khác/,
    );
  });

  it("từ chối token hết hạn, sai nguồn, hoặc email chưa xác minh", () => {
    expect(() =>
      readIdentity(token({ ...valid, exp: Math.floor(Date.now() / 1000) - 10 }), CLIENT),
    ).toThrow(/hết hạn/);
    expect(() => readIdentity(token({ ...valid, iss: "https://ke-gia-mao" }), CLIENT)).toThrow(
      /do Google cấp/,
    );
    // Email chưa xác minh thì ai cũng khai được, mà email chính là khoá nhận ra
    // người quay lại — nhận vào là mở cửa cho việc chiếm tài khoản.
    expect(() => readIdentity(token({ ...valid, email_verified: false }), CLIENT)).toThrow(
      /chưa được xác minh/,
    );
  });

  it("từ chối chuỗi không phải token", () => {
    expect(() => readIdentity("khong-phai-token", CLIENT)).toThrow(/định dạng/);
  });
});

describe("hàm thuần của tài khoản", () => {
  it("chuẩn hoá email trước khi so sánh", () => {
    // Một chữ hoa lạc vào là lần đăng nhập sau mọc ra tài khoản thứ hai, mang
    // theo một nửa lịch sử.
    expect(normalizeEmail("  Nam@Example.COM ")).toBe("nam@example.com");
  });

  it("tài khoản không có tên thì lấy phần trước @", () => {
    expect(displayNameFrom("", "nam@example.com")).toBe("nam");
    expect(displayNameFrom("  Nam  ", "x@y.com")).toBe("Nam");
  });

  it("gộp danh sách buổi mà không đánh rơi mã cũ", () => {
    // Người vừa xoá dữ liệu trình duyệt sẽ gửi lên danh sách rỗng. Tin nó là
    // biến chính lần đăng nhập lại thành lúc lịch sử biến mất.
    expect(mergeRecentEvents(["A", "B"], [])).toEqual(["A", "B"]);
    expect(mergeRecentEvents(["A", "B"], ["C", "A"])).toEqual(["C", "A", "B"]);
    expect(mergeRecentEvents(["A"], ["A"])).toEqual(["A"]);
    expect(mergeRecentEvents(["A", "B", "C"], [], 2)).toEqual(["A", "B"]);
  });
});

describe("kho tài khoản", () => {
  function fresh() {
    const sheets = new FakeSheetsClient();
    return { sheets, repo: new AccountRepo(sheets) };
  }

  const seed = {
    email: "nam@example.com",
    displayName: "Nam",
    avatarId: "e01-c01",
    at: 1000,
  };

  it("người quay lại nhận đúng tài khoản cũ, không tạo bản sao", async () => {
    const { repo } = fresh();
    const first = await repo.upsertByEmail(seed);
    const second = await repo.upsertByEmail({ ...seed, at: 2000 });

    expect(second.userId).toBe(first.userId);
    expect(second.createdAt).toBe(1000);
  });

  it("chữ hoa trong email vẫn là cùng một người", async () => {
    const { repo } = fresh();
    const first = await repo.upsertByEmail(seed);
    const again = await repo.upsertByEmail({ ...seed, email: "NAM@Example.com" });
    expect(again.userId).toBe(first.userId);
  });

  it("lần đăng nhập sau không ghi đè tên đã sửa", async () => {
    // Trong nhóm chơi người ta gọi nhau bằng biệt danh. Sửa tên rồi mà lần đăng
    // nhập sau nó lặng lẽ quay về tên trên giấy tờ là phần mềm cãi lại người dùng.
    const { repo } = fresh();
    const account = await repo.upsertByEmail(seed);
    await repo.updateAccount(account.userId, { displayName: "Nam Béo" });

    const again = await repo.upsertByEmail({ ...seed, displayName: "Nguyễn Văn Nam" });
    expect(again.displayName).toBe("Nam Béo");
  });

  it("gắn thiết bị vào tài khoản, và đổi chủ khi người khác đăng nhập", async () => {
    const { repo } = fresh();
    const nam = await repo.upsertByEmail(seed);
    const lan = await repo.upsertByEmail({ ...seed, email: "lan@example.com" });

    await repo.linkDevice({
      deviceId: "dt-1",
      userId: nam.userId,
      displayName: "Nam",
      avatarId: "e01-c01",
      recentEvents: ["AAA111"],
      at: 1000,
    });
    expect((await repo.devicesOf(nam.userId)).map((d) => d.deviceId)).toEqual(["dt-1"]);

    // Điện thoại dùng chung: người sau nhận máy, nhưng lịch sử của cái máy đó
    // không mất — những buổi ấy cả hai đều có mặt.
    await repo.linkDevice({
      deviceId: "dt-1",
      userId: lan.userId,
      displayName: "Lan",
      avatarId: "e02-c02",
      recentEvents: ["BBB222"],
      at: 2000,
    });
    expect(await repo.devicesOf(nam.userId)).toEqual([]);
    const link = await repo.deviceLink("dt-1");
    expect(link?.userId).toBe(lan.userId);
    expect(link?.recentEvents).toEqual(["BBB222", "AAA111"]);
  });

  describe("gỡ máy khỏi tài khoản", () => {
    async function twoDevices() {
      const { sheets, repo } = fresh();
      const nam = await repo.upsertByEmail(seed);
      for (const [deviceId, code] of [
        ["dt-cu", "AAA111"],
        ["dt-moi", "BBB222"],
      ] as const) {
        await repo.linkDevice({
          deviceId,
          userId: nam.userId,
          displayName: "Nam",
          avatarId: "e01-c01",
          recentEvents: [code],
          at: 1000,
        });
      }
      return { sheets, repo, nam };
    }

    it("gỡ rồi thì máy đó không còn được gộp, và mất luôn danh sách buổi", async () => {
      const { repo, nam } = await twoDevices();

      expect(await repo.unlinkDevice(nam.userId, "dt-cu")).toBe(true);
      expect((await repo.devicesOf(nam.userId)).map((d) => d.deviceId)).toEqual(["dt-moi"]);

      // Dòng vẫn còn — `SheetsClient` không xoá dòng được, và xoá thật thì mọi
      // rowIndex phía dưới đều xê dịch.
      const link = await repo.deviceLink("dt-cu");
      expect(link?.userId).toBe("");
      expect(link?.recentEvents).toEqual([]);
    });

    it("không gỡ được máy của người khác, và không ghi gì", async () => {
      const { sheets, repo, nam } = await twoDevices();
      const lan = await repo.upsertByEmail({ ...seed, email: "lan@example.com" });

      const before = sheets.calls.batch;
      expect(await repo.unlinkDevice(lan.userId, "dt-cu")).toBe(false);
      expect(sheets.calls.batch).toBe(before);
      expect((await repo.devicesOf(nam.userId)).length).toBe(2);
    });

    it("máy không có trong sổ thì trả false chứ không ném lỗi", async () => {
      const { repo, nam } = await twoDevices();
      expect(await repo.unlinkDevice(nam.userId, "dt-khong-co")).toBe(false);
    });

    it("máy đã gỡ không ghi ngược danh sách buổi lên nữa", async () => {
      // Cookie tài khoản sống 30 ngày và không có danh sách thu hồi, nên cái máy
      // vừa bị gỡ vẫn gọi được tới đây. Thiếu chốt chặn này thì nó mở trang "Của
      // tôi" một lần là danh sách quay về, và việc gỡ thành vô nghĩa.
      const { sheets, repo, nam } = await twoDevices();
      await repo.unlinkDevice(nam.userId, "dt-cu");

      const before = sheets.calls.batch;
      expect(await repo.rememberEvents("dt-cu", ["CCC333"], 4000)).toBe(false);
      expect(sheets.calls.batch).toBe(before);
      expect((await repo.deviceLink("dt-cu"))?.recentEvents).toEqual([]);
    });

    it("người khác đăng nhập lên máy đó không thừa hưởng buổi cũ", async () => {
      const { repo, nam } = await twoDevices();
      await repo.unlinkDevice(nam.userId, "dt-cu");

      const lan = await repo.upsertByEmail({ ...seed, email: "lan@example.com" });
      await repo.linkDevice({
        deviceId: "dt-cu",
        userId: lan.userId,
        displayName: "Lan",
        avatarId: "e02-c02",
        recentEvents: ["DDD444"],
        at: 5000,
      });

      expect((await repo.deviceLink("dt-cu"))?.recentEvents).toEqual(["DDD444"]);
    });
  });

  it("không ghi lại khi danh sách buổi không đổi", async () => {
    // Trang "Của tôi" mở ra là gọi tới đây. Ghi một lần cho mỗi lần mở là đốt
    // hạn mức Sheets vào việc lưu đúng thứ đã có sẵn.
    const { sheets, repo } = fresh();
    const nam = await repo.upsertByEmail(seed);
    await repo.linkDevice({
      deviceId: "dt-1",
      userId: nam.userId,
      displayName: "Nam",
      avatarId: "e01-c01",
      recentEvents: ["AAA111"],
      at: 1000,
    });

    const before = sheets.calls.batch;
    expect(await repo.rememberEvents("dt-1", ["AAA111"], 3000)).toBe(false);
    expect(sheets.calls.batch).toBe(before);

    expect(await repo.rememberEvents("dt-1", ["CCC333"], 3000)).toBe(true);
    expect((await repo.deviceLink("dt-1"))?.recentEvents).toEqual(["CCC333", "AAA111"]);
  });

  it("máy chưa đăng nhập bao giờ thì không ghi gì cả", async () => {
    const { sheets, repo } = fresh();
    await repo.bootstrap();
    const before = sheets.calls.batch;
    expect(await repo.rememberEvents("dt-la", ["AAA111"], 1000)).toBe(false);
    expect(sheets.calls.batch).toBe(before);
  });
});

describe("đăng nhập rồi thì câu lạc bộ nhận ra mình", () => {
  async function clubWithLogin() {
    const sheets = new FakeSheetsClient();
    const clubs = new ClubRepo(sheets);
    const accounts = new AccountRepo(sheets);

    const created = await clubs.create({
      name: "CLB Tối Thứ Ba",
      ownerDeviceId: "dt-cu",
      ownerName: "Chủ sân",
      ownerAvatarId: "e01-c01",
      at: 1000,
    });
    const account = await accounts.upsertByEmail({
      email: "chu@example.com",
      displayName: "Chủ sân",
      avatarId: "e01-c01",
      at: 1000,
    });
    return { sheets, clubs, accounts, created, account };
  }

  it("đăng nhập gắn cả danh bạ lẫn quyền chủ về tài khoản", async () => {
    const { clubs, created, account } = await clubWithLogin();

    const claimed = await clubs.claimForDevice("dt-cu", account.userId);
    expect(claimed).toEqual({ members: 1, clubs: 1 });

    const loaded = await clubs.load(created.club.id);
    expect(loaded!.members[0]!.userId).toBe(account.userId);
    expect(loaded!.club.ownerRef).toBe(ownerRefForUser(account.userId));
  });

  it("chủ câu lạc bộ không mất quyền vì vừa đăng nhập", async () => {
    // Đây là chỗ dễ hỏng nhất của cả việc chuyển sang tài khoản: đổi `ownerRef`
    // mà quên đường so sánh cũ thì đúng lúc đăng nhập, người ta mất quyền với
    // câu lạc bộ của chính mình.
    const { clubs, created, account } = await clubWithLogin();
    const before = await clubs.load(created.club.id);
    expect(isClubOwner(before!.club, { deviceId: "dt-cu" })).toBe(true);

    await clubs.claimForDevice("dt-cu", account.userId);
    const after = await clubs.load(created.club.id);

    expect(isClubOwner(after!.club, { userId: account.userId })).toBe(true);
    expect(isClubOwner(after!.club, { deviceId: "dt-la", userId: "u-la" })).toBe(false);
  });

  it("máy thứ hai của cùng người không mọc thêm dòng trong danh bạ", async () => {
    // Không có bước này thì đăng nhập trên điện thoại mới sinh ra một "Chủ sân"
    // thứ hai, và danh bạ hỏng rất nhanh.
    const { clubs, created, account } = await clubWithLogin();
    await clubs.claimForDevice("dt-cu", account.userId);

    const again = await clubs.addMember(
      created.club.id,
      {
        displayName: "Chủ sân",
        avatarId: "e01-c01",
        deviceId: "dt-moi",
        userId: account.userId,
      },
      2000,
    );

    const loaded = await clubs.load(created.club.id);
    expect(loaded!.members).toHaveLength(1);
    expect(again.memberId).toBe(created.members[0]!.memberId);
  });

  it("tìm được thành viên qua tài khoản lẫn qua máy", async () => {
    const { clubs, created, account } = await clubWithLogin();
    await clubs.claimForDevice("dt-cu", account.userId);
    const members = (await clubs.load(created.club.id))!.members;

    expect(memberForUser(members, account.userId)?.displayName).toBe("Chủ sân");
    expect(memberForDevice(members, "dt-cu")?.displayName).toBe("Chủ sân");
    expect(memberForUser(members, "u-nguoi-la")).toBeNull();
  });

  it("câu lạc bộ tạo khi đã đăng nhập thuộc về tài khoản ngay từ đầu", async () => {
    const sheets = new FakeSheetsClient();
    const clubs = new ClubRepo(sheets);
    const created = await clubs.create({
      name: "CLB Sáng Chủ Nhật",
      ownerDeviceId: "dt-1",
      ownerUserId: "u-nam",
      ownerName: "Nam",
      ownerAvatarId: "e01-c01",
      at: 1000,
    });

    expect(created.club.ownerRef).toBe(ownerRefForUser("u-nam"));
    expect(created.members[0]!.userId).toBe("u-nam");
    // Vẫn phải nhận ra qua máy: chủ sân mở lại trên đúng điện thoại đó mà chưa
    // kịp đăng nhập lại thì không được coi là người lạ.
    expect(await clubs.forDevice("dt-1")).toHaveLength(1);
    expect(await clubs.forUser("u-nam")).toHaveLength(1);
  });

  it("đăng nhập lại lần nữa không tốn lời gọi ghi nào", async () => {
    const { sheets, clubs, account } = await clubWithLogin();
    await clubs.claimForDevice("dt-cu", account.userId);

    const before = sheets.calls.batch;
    expect(await clubs.claimForDevice("dt-cu", account.userId)).toEqual({
      members: 0,
      clubs: 0,
    });
    expect(sheets.calls.batch).toBe(before);
  });
});

describe("nhận ra mình giữa buổi đánh", () => {
  const state = (players: Array<Partial<Player>>) =>
    ({ players: players as Player[] }) as EventState;

  it("tài khoản được ưu tiên hơn thiết bị", () => {
    // Đây là toàn bộ điểm của việc đăng nhập: đổi điện thoại giữa mùa thì cái
    // máy mới chưa có trong buổi đánh nào cả, nhưng tài khoản thì có.
    const s = state([
      { id: "p1", userId: "u-nam", deviceId: "dt-cu" },
      { id: "p2", deviceId: "dt-moi" },
    ]);
    expect(findMyPlayer(s, "dt-moi", "u-nam")?.id).toBe("p1");
    expect(findMyPlayer(s, "dt-moi", null)?.id).toBe("p2");
    expect(findMyPlayer(s, "", "u-la")).toBeNull();
  });

  it("máy chưa từng vào buổi này thì vẫn nhận ra nhờ tài khoản", () => {
    const s = state([{ id: "p1", userId: "u-nam" }]);
    expect(findMyPlayer(s, "dt-hoan-toan-moi", "u-nam")?.id).toBe("p1");
    // Chưa đăng nhập thì đành chịu — và đó là lý do có nút đăng nhập.
    expect(findMyPlayer(s, "dt-hoan-toan-moi", null)).toBeNull();
  });
});

describe('nhận ô tên "Đây là tôi"', () => {
  function withUnclaimed() {
    const sim = new EventSim({ planning: { iterations: 200, timeBudgetMs: 20 } });
    // Chủ sân gõ sẵn bốn cái tên, chưa máy nào nhận.
    const ids = ["Nam", "Lan", "Hùng", "Tú"].map((n) =>
      sim.addPlayer(n, { asActive: false }),
    );
    return { sim, ids };
  }

  it("gắn máy và tài khoản vào ô tên, không cần quyền gì", () => {
    // Lỗi cũ: `UpdateProfile` đổi được tên nhưng KHÔNG gắn máy vào, nên người
    // vừa nhận xong mở lại app là app quên mất họ và bắt gõ tên lần nữa.
    const { sim, ids } = withUnclaimed();
    sim.send({
      type: "ClaimPlayer",
      playerId: ids[0]!,
      name: "Nam",
      avatarId: "e05-c05",
      deviceId: "dt-nam",
      userId: "u-nam",
    });

    const nam = sim.state.players.find((p) => p.id === ids[0]);
    expect(nam?.deviceId).toBe("dt-nam");
    expect(nam?.userId).toBe("u-nam");
    expect(nam?.avatarId).toBe("e05-c05");
    expect(nam?.status).toBe("confirmed");
  });

  it("ô tên đã có chủ thì người khác không nhận đè được", () => {
    const { sim, ids } = withUnclaimed();
    sim.send({ type: "ClaimPlayer", playerId: ids[0]!, deviceId: "dt-nam" });

    const error = sim.trySend({
      type: "ClaimPlayer",
      playerId: ids[0]!,
      name: "Kẻ cướp",
      deviceId: "dt-ke-cuop",
    });
    expect(error).toMatch(/đã có người nhận/);
    expect(sim.state.players.find((p) => p.id === ids[0])?.deviceId).toBe("dt-nam");
  });

  it("cùng một máy bấm hai lần thì không sao", () => {
    // Sóng yếu ở sân là bấm lại, và hàng đợi ngoại tuyến cũng gửi lại.
    const { sim, ids } = withUnclaimed();
    sim.send({ type: "ClaimPlayer", playerId: ids[0]!, deviceId: "dt-nam" });
    expect(sim.trySend({ type: "ClaimPlayer", playerId: ids[0]!, deviceId: "dt-nam" })).toBeNull();
  });

  it("sau giờ bắt đầu thì vẫn phải chờ duyệt", () => {
    // Chủ sân gõ sẵn cái tên không có nghĩa là đồng ý cho người vừa quét mã vào
    // sân giữa buổi. Trộn hai việc đó là xếp lịch cho một người không ai biết.
    const { sim, ids } = withUnclaimed();
    for (const id of ids) sim.send({ type: "MarkArrived", playerId: id });
    sim.send({ type: "StartEvent" });

    const late = sim.addPlayer("Người tới muộn", { asActive: false });
    sim.send({ type: "ClaimPlayer", playerId: late, deviceId: "dt-muon" });
    expect(sim.state.players.find((p) => p.id === late)?.status).toBe("pendingApproval");
  });
});
