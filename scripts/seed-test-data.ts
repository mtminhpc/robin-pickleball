/**
 * Dữ liệu sân thử bền vững, chỉ nằm trong `.data/test-sandbox.json`.
 *
 * Chạy lại bao nhiêu lần cũng không nhân đôi CLB, thành viên hay sự kiện. Nếu
 * người dùng đã nhập điểm/chỉnh trạng thái trong sự kiện TEST11 thì script giữ
 * nguyên; muốn một kho trắng hoàn toàn, tự đổi `ROBIN_TEST_DATA_PATH` sang tệp
 * mới thay vì xoá dữ liệu đang thử dở.
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { CommandEnvelope } from "../lib/domain/commands";
import { fold } from "../lib/domain/reduce";
import { DEFAULT_CONFIG } from "../lib/domain/types";
import { hashPassword } from "../lib/auth/passwords";
import { planSchedule } from "../lib/scheduler/plan";
import { ClubRepo } from "../lib/sheets/clubs";
import { LocalFileSheetsClient } from "../lib/sheets/local";
import { EventRepo } from "../lib/sheets/repo";
import { EventAssetRepo } from "../lib/sheets/event-assets";

export const TEST_DATA_PATH = resolve(
  process.env.ROBIN_TEST_DATA_PATH ?? ".data/test-sandbox.json",
);
export const TEST_EVENT_CODE = "TEST11";
export const TEST_V5_EVENT_CODE = "TESTV5";
export const TEST_PLAYER_PASSWORD = "test1234";
export const TEST_ADMIN_PASSWORD = "admin1234";

const CLUB_NAME = "CLB TEST ROBIN";
const OWNER_DEVICE = "robin-test-owner-device";
const TEST_NAMES = [
  "TEST An",
  "TEST Bình",
  "TEST Cường",
  "TEST Dũng",
  "TEST Giang",
  "TEST Hà",
  "TEST Hùng",
  "TEST Khánh",
  "TEST Lan",
  "TEST Linh",
  "TEST Minh",
] as const;

export async function seedTestData(path = TEST_DATA_PATH): Promise<void> {
  const sheets = new LocalFileSheetsClient(path);
  const clubs = new ClubRepo(sheets);
  const events = new EventRepo(sheets);
  const assets = new EventAssetRepo(sheets);
  const now = Date.now();

  const mine = await clubs.forDevice(OWNER_DEVICE);
  let club = mine.find((item) => item.name === CLUB_NAME);
  if (!club) {
    club = (
      await clubs.create({
        name: CLUB_NAME,
        ownerDeviceId: OWNER_DEVICE,
        ownerName: TEST_NAMES[0],
        ownerAvatarId: "e01-c01",
        settings: { defaultCourts: 2, defaultPointsTo: 11 },
        at: now,
      })
    ).club;
  }

  let loadedClub = await clubs.load(club.id);
  if (!loadedClub) throw new Error("Không đọc lại được CLB TEST vừa tạo.");

  for (let i = 1; i < TEST_NAMES.length; i++) {
    await clubs.addMember(
      club.id,
      {
        displayName: TEST_NAMES[i]!,
        avatarId: `e0${(i % 5) + 1}-c0${(i % 4) + 1}`,
        deviceId: `robin-test-player-${i + 1}`,
      },
      now + i,
    );
  }
  loadedClub = await clubs.load(club.id);
  if (!loadedClub) throw new Error("Không đọc được danh bạ CLB TEST.");

  let event = await events.load(TEST_EVENT_CODE);
  if (!event) {
    const record = await events.create(
      {
        code: TEST_EVENT_CODE,
        clubId: club.id,
        name: "SÂN TEST · 4–11 NGƯỜI",
        status: "draft",
        ownerUserId: "test-owner",
        playerPassHash: await hashPassword(TEST_PLAYER_PASSWORD),
        adminPassHash: await hashPassword(TEST_ADMIN_PASSWORD),
      },
      now,
    );

    const actor = { kind: "admin", label: "TEST Chủ sân", ref: OWNER_DEVICE } as const;
    const members = loadedClub.members
      .filter((member) => member.status === "active")
      .slice(0, TEST_NAMES.length);
    const commands: CommandEnvelope[] = [
      {
        id: "test-create-event",
        at: now,
        actor,
        command: {
          type: "CreateEvent",
          code: TEST_EVENT_CODE,
          clubId: club.id,
          config: {
            ...DEFAULT_CONFIG,
            name: "SÂN TEST · 4–11 NGƯỜI",
            courts: 2,
          },
        },
      },
      ...members.map((member, i) => ({
        id: `test-add-player-${i + 1}`,
        at: now + i + 1,
        actor,
        command: {
          type: "AddPlayer" as const,
          player: {
            id: member.memberId,
            name: member.displayName,
            avatarId: member.avatarId,
            memberId: member.memberId,
            deviceId: member.deviceId,
          },
          asActive: true,
        },
      })),
      {
        id: "test-start-event",
        at: now + members.length + 1,
        actor,
        command: { type: "StartEvent" },
      },
    ];

    const interim = fold(TEST_EVENT_CODE, commands);
    if (interim.skipped.length > 0) {
      throw new Error(`Không dựng được sự kiện TEST: ${interim.skipped[0]!.error}`);
    }
    const schedule = planSchedule(interim.state, { mode: "extend", seed: 4242 });
    if (schedule.blocked) throw new Error(schedule.blocked);
    commands.push({
      id: "test-initial-schedule",
      at: now + members.length + 2,
      actor,
      command: {
        type: "SetSchedule",
        fromRound: schedule.fromRound,
        matches: schedule.matches,
      },
    });

    const committed = await events.commitMany(TEST_EVENT_CODE, commands, {
      record,
      state: fold(TEST_EVENT_CODE, []).state,
      repaired: false,
      skipped: [],
    });
    if (!committed.ok) throw new Error(committed.error);
    event = await events.load(TEST_EVENT_CODE);
  }

  // Fixture v0.5.0 tách riêng: TEST11 vẫn là sân đang đánh để thử công bằng,
  // TESTV5 đã kết thúc để mở được Bảng vàng và xem đủ dải tài trợ.
  let v5 = await events.load(TEST_V5_EVENT_CODE);
  if (!v5) {
    const record = await events.create(
      {
        code: TEST_V5_EVENT_CODE,
        clubId: club.id,
        name: "SÂN TEST V5 · TÀI TRỢ & BẢNG VÀNG",
        status: "draft",
        ownerUserId: "test-owner",
        playerPassHash: "",
        adminPassHash: await hashPassword(TEST_ADMIN_PASSWORD),
      },
      now + 100,
    );
    const actor = { kind: "admin", label: "TEST Chủ sân", ref: OWNER_DEVICE } as const;
    const members = loadedClub.members.filter((member) => member.status === "active").slice(0, 6);
    const tiers = ["diamond", "diamond", "gold", "gold", "silver", "silver", "partner", "partner", "custom"] as const;
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    for (let i = 0; i < tiers.length; i++) {
      await assets.put({
        eventCode: TEST_V5_EVENT_CODE,
        assetId: `testv5-logo-${i + 1}`,
        kind: "sponsor",
        mime: "image/png",
        dataUri: tinyPng,
        createdBy: "test-owner",
        createdAt: now + 110 + i,
        updatedAt: now + 110 + i,
      });
    }
    const commands: CommandEnvelope[] = [
      {
        id: "testv5-create",
        at: now + 100,
        actor,
        command: {
          type: "CreateEvent",
          code: TEST_V5_EVENT_CODE,
          clubId: club.id,
          config: { ...DEFAULT_CONFIG, name: "SÂN TEST V5 · TÀI TRỢ & BẢNG VÀNG", courts: 2 },
        },
      },
      ...members.map((member, index) => ({
        id: `testv5-player-${index + 1}`,
        at: now + 120 + index,
        actor,
        command: {
          type: "AddPlayer" as const,
          player: { id: member.memberId, name: member.displayName, avatarId: member.avatarId, memberId: member.memberId, deviceId: member.deviceId },
          asActive: true,
        },
      })),
      { id: "testv5-start", at: now + 130, actor, command: { type: "StartEvent" as const } },
      {
        id: "testv5-schedule",
        at: now + 131,
        actor,
        command: {
          type: "SetSchedule" as const,
          fromRound: 1,
          matches: [
            { id: "testv5-m1", round: 1, court: 1, teamA: [members[0]!.memberId, members[1]!.memberId] as [string, string], teamB: [members[2]!.memberId, members[3]!.memberId] as [string, string] },
            { id: "testv5-m2", round: 2, court: 1, teamA: [members[0]!.memberId, members[2]!.memberId] as [string, string], teamB: [members[4]!.memberId, members[5]!.memberId] as [string, string] },
            { id: "testv5-m3", round: 3, court: 1, teamA: [members[1]!.memberId, members[3]!.memberId] as [string, string], teamB: [members[4]!.memberId, members[5]!.memberId] as [string, string] },
          ],
        },
      },
      { id: "testv5-score-1", at: now + 132, actor, command: { type: "SubmitResult" as const, matchId: "testv5-m1", scoreA: 11, scoreB: 7, irregular: false } },
      { id: "testv5-score-2", at: now + 133, actor, command: { type: "SubmitResult" as const, matchId: "testv5-m2", scoreA: 11, scoreB: 8, irregular: false } },
      { id: "testv5-score-3", at: now + 134, actor, command: { type: "SubmitResult" as const, matchId: "testv5-m3", scoreA: 6, scoreB: 11, irregular: false } },
      { id: "testv5-finish", at: now + 135, actor, command: { type: "FinishEvent" as const } },
      { id: "testv5-shape", at: now + 136, actor, command: { type: "SetSponsorLogoShape" as const, shape: "square" as const } },
      ...tiers.map((tier, index) => ({
        id: `testv5-sponsor-${index + 1}`,
        at: now + 140 + index,
        actor,
        command: {
          type: "UpsertSponsor" as const,
          sponsor: {
            id: `testv5-sponsor-${index + 1}`,
            name: `TEST ${tier.toUpperCase()} ${index + 1}`,
            tier,
            ...(tier === "custom" ? { tierLabel: "Tài trợ bóng" } : {}),
            assetId: `testv5-logo-${index + 1}`,
            order: index,
          },
        },
      })),
      {
        id: "testv5-award-champion",
        at: now + 160,
        actor,
        command: { type: "UpsertAward", award: { id: "testv5-champion", kind: "champion", label: "Vô địch", recipientIds: [members[0]!.memberId], trophyMode: "framed" } },
      },
      {
        id: "testv5-award-tie",
        at: now + 161,
        actor,
        command: { type: "UpsertAward", award: { id: "testv5-runner-up", kind: "runnerUp", label: "Á quân", recipientIds: [members[1]!.memberId, members[2]!.memberId], trophyMode: "transparent" } },
      },
      {
        id: "testv5-award-custom",
        at: now + 162,
        actor,
        command: { type: "UpsertAward", award: { id: "testv5-fair-play", kind: "custom", label: "Fair Play", recipientIds: [members[0]!.memberId, members[3]!.memberId], trophyMode: "framed" } },
      },
    ];
    const committed = await events.commitMany(TEST_V5_EVENT_CODE, commands, {
      record,
      state: fold(TEST_V5_EVENT_CODE, []).state,
      repaired: false,
      skipped: [],
    });
    if (!committed.ok) throw new Error(committed.error);
    v5 = await events.load(TEST_V5_EVENT_CODE);
  }

  console.log(`Đã giữ dữ liệu TEST tại: ${path}`);
  console.log(`CLB: ${club.name} · mã mời ${club.inviteCode}`);
  console.log(`Sân/sự kiện: ${event?.state.config.name ?? TEST_EVENT_CODE} · mã ${TEST_EVENT_CODE}`);
  console.log(`Trưng bày v0.5: ${v5?.state.config.name ?? TEST_V5_EVENT_CODE} · mã ${TEST_V5_EVENT_CODE}`);
  console.log(`Người chơi: ${loadedClub.members.filter((m) => m.status === "active").length}`);
  console.log(`Mật khẩu người chơi: ${TEST_PLAYER_PASSWORD}`);
  console.log(`Mật khẩu quản trị: ${TEST_ADMIN_PASSWORD}`);
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;
if (invokedDirectly) {
  seedTestData().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
