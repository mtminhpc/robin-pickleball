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
import { DEFAULT_CONFIG, type EventCourt } from "../lib/domain/types";
import { hashPassword } from "../lib/auth/passwords";
import { planSchedule } from "../lib/scheduler/plan";
import { ClubRepo } from "../lib/sheets/clubs";
import { LocalFileSheetsClient } from "../lib/sheets/local";
import { EventRepo } from "../lib/sheets/repo";
import { EventAssetRepo } from "../lib/sheets/event-assets";
import { EventStaffRepo } from "../lib/sheets/event-staff";
import { EventRoleRepo } from "../lib/sheets/event-roles";
import { hashRoleInvitation } from "../lib/auth/role-invitations";
import type { EventRoleAction } from "../lib/domain/event-roles";

export const TEST_DATA_PATH = resolve(
  process.env.ROBIN_TEST_DATA_PATH ?? ".data/test-sandbox.json",
);
export const TEST_EVENT_CODE = "TEST11";
export const TEST_V5_EVENT_CODE = "TESTV5";
export const TEST_V6_EVENT_CODE = "TESTV6";
export const TEST_V8_EVENT_CODE = "TESTV8";
export const TEST_V9_EVENT_CODE = "TESTV9";
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
  const staff = new EventStaffRepo(sheets);
  const roles = new EventRoleRepo(sheets);
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

  // TESTV6 đang chạy, một sân vừa trống: dùng để thử Phó sự kiện, editor ảnh,
  // ước tính và đưa đúng một trận tương lai lên mà không đổi cả vòng.
  let v6 = await events.load(TEST_V6_EVENT_CODE);
  if (!v6) {
    const record = await events.create({
      code: TEST_V6_EVENT_CODE,
      clubId: club.id,
      name: "SÂN TEST V6 · ĐIỀU HÀNH & DỜI TRẬN",
      status: "draft",
      ownerUserId: "test-owner",
      playerPassHash: "",
      adminPassHash: await hashPassword(TEST_ADMIN_PASSWORD),
    }, now + 300);
    const actor = { kind: "admin", label: "Chủ sự kiện · TEST Chủ sân", ref: "test-owner" } as const;
    const members = loadedClub.members.filter((member) => member.status === "active").slice(0, 8);
    const png256 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABFUlEQVR4nO3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA6AwBPAABo9vSmwAAAABJRU5ErkJggg==";
    const crops = [
      { x: 0, y: 64, width: 512, height: 128 },
      { x: 64, y: 0, width: 128, height: 512 },
      { x: 0, y: 0, width: 256, height: 256 },
    ];
    for (let index = 0; index < crops.length; index++) {
      await assets.put({
        eventCode: TEST_V6_EVENT_CODE,
        assetId: `testv6-logo-${index + 1}`,
        kind: "sponsor",
        mime: "image/png",
        dataUri: png256,
        metadata: { fit: "contain", zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, trim: index === 2, crop: crops[index]!, output: { width: 256, height: 256 } },
        createdBy: "test-owner",
        createdAt: now + 301 + index,
        updatedAt: now + 301 + index,
      });
    }
    const commands: CommandEnvelope[] = [{
      id: "testv6-create", at: now + 300, actor,
      command: { type: "CreateEvent", code: TEST_V6_EVENT_CODE, clubId: club.id, config: { ...DEFAULT_CONFIG, name: "SÂN TEST V6 · ĐIỀU HÀNH & DỜI TRẬN", venueAddress: "123 Sân TEST, Việt Nam", courts: 1, expectedPlayers: 8, targetGamesPerPlayer: 6, estimatedMatchMinutes: 15, courtTurnoverMinutes: 3 } },
    }, ...members.map((member, index) => ({
      id: `testv6-player-${index + 1}`, at: now + 310 + index, actor,
      command: { type: "AddPlayer" as const, player: { id: `testv6-p${index + 1}`, name: member.displayName, avatarId: member.avatarId, ...(index < 2 ? { userId: `test-user-${index + 1}` } : {}) }, asActive: true },
    })), {
      id: "testv6-start", at: now + 320, actor, command: { type: "StartEvent" },
    }, {
      id: "testv6-schedule", at: now + 321, actor, command: { type: "SetSchedule", fromRound: 1, matches: [
        { id: "testv6-m1", round: 1, court: 1, teamA: ["testv6-p1", "testv6-p2"], teamB: ["testv6-p3", "testv6-p4"] },
        { id: "testv6-m2", round: 2, court: 1, teamA: ["testv6-p5", "testv6-p6"], teamB: ["testv6-p7", "testv6-p8"] },
        { id: "testv6-m3", round: 3, court: 1, teamA: ["testv6-p1", "testv6-p5"], teamB: ["testv6-p2", "testv6-p6"] },
      ] },
    }, {
      id: "testv6-score", at: now + 322, actor, command: { type: "SubmitResult", matchId: "testv6-m1", scoreA: 11, scoreB: 7, irregular: false },
    }, {
      id: "testv6-shape", at: now + 323, actor, command: { type: "SetSponsorLogoShape", shape: "square" },
    }, ...crops.map((_, index) => ({
      id: `testv6-sponsor-${index + 1}`, at: now + 324 + index, actor,
      command: { type: "UpsertSponsor" as const, sponsor: { id: `testv6-sponsor-${index + 1}`, name: `TEST LOGO ${index === 0 ? "NGANG" : index === 1 ? "DỌC" : "TRONG"}`, tier: index === 0 ? "diamond" as const : index === 1 ? "gold" as const : "custom" as const, ...(index === 2 ? { tierLabel: "Media TEST" } : {}), assetId: `testv6-logo-${index + 1}`, order: index } },
    }))];
    const committed = await events.commitMany(TEST_V6_EVENT_CODE, commands, { record, state: fold(TEST_V6_EVENT_CODE, []).state, repaired: false, skipped: [] });
    if (!committed.ok) throw new Error(committed.error);
    await staff.invite({ eventCode: TEST_V6_EVENT_CODE, email: "pho.test@example.com", grantedBy: "test-owner", at: now + 330 });
    v6 = await events.load(TEST_V6_EVENT_CODE);
  }

  // TESTV8 là sân chạy thật cho luồng cấu trúc động: tên sân ổn định, ca sân theo
  // vòng và nhiều ca dự kiến của người chơi. Seed chỉ tạo khi mã chưa tồn tại.
  let v8 = await events.load(TEST_V8_EVENT_CODE);
  if (!v8) {
    const record = await events.create({
      code: TEST_V8_EVENT_CODE,
      clubId: club.id,
      name: "SÂN TEST V8 · LINH ĐỘNG",
      status: "draft",
      ownerUserId: "test-owner",
      playerPassHash: await hashPassword(TEST_PLAYER_PASSWORD),
      adminPassHash: await hashPassword(TEST_ADMIN_PASSWORD),
    }, now + 500);
    const actor = {
      kind: "admin",
      label: "Chủ sự kiện · TEST Linh động",
      ref: "test-owner",
    } as const;
    const members = loadedClub.members
      .filter((member) => member.status === "active")
      .slice(0, 10);
    const courts: EventCourt[] = [
      {
        id: "testv8-court-7",
        order: 1,
        labels: [{ id: "testv8-court-7-label-1", name: "Sân số 7", effectiveFromRound: 1 }],
        availability: [{ from: 1, to: null }],
        archived: false,
      },
      {
        id: "testv8-court-9",
        order: 2,
        labels: [{ id: "testv8-court-9-label-1", name: "Sân số 9", effectiveFromRound: 1 }],
        availability: [{ from: 1, to: 3 }, { from: 6, to: null }],
        archived: false,
      },
      {
        id: "testv8-court-roof",
        order: 3,
        labels: [{ id: "testv8-court-roof-label-1", name: "Sân Mái Kính", effectiveFromRound: 1 }],
        availability: [{ from: 3, to: 7 }],
        archived: false,
      },
    ];
    const commands: CommandEnvelope[] = [{
      id: "testv8-create",
      at: now + 500,
      actor,
      command: {
        type: "CreateEvent",
        code: TEST_V8_EVENT_CODE,
        clubId: club.id,
        config: {
          ...DEFAULT_CONFIG,
          name: "SÂN TEST V8 · LINH ĐỘNG",
          courts: 2,
          expectedPlayers: 10,
          targetGamesPerPlayer: 7,
        },
        courts,
      },
    }, ...members.map((member, index) => ({
      id: `testv8-player-${index + 1}`,
      at: now + 510 + index,
      actor,
      command: {
        type: "AddPlayer" as const,
        player: {
          id: `testv8-p${index + 1}`,
          name: member.displayName,
          avatarId: member.avatarId,
          deviceId: `testv8-device-${index + 1}`,
          ...(index < 2 ? { userId: `testv8-user-${index + 1}` } : {}),
        },
        asActive: true,
      },
    })), {
      id: "testv8-plan-p1",
      at: now + 530,
      actor,
      command: {
        type: "SetPlayerPlan",
        playerId: "testv8-p1",
        availability: [
          { id: "testv8-p1-morning", from: 1, to: 3 },
          { id: "testv8-p1-evening", from: 6, to: null },
        ],
        effectiveRound: 1,
      },
    }, {
      id: "testv8-plan-p2",
      at: now + 532,
      actor,
      command: {
        type: "SetPlayerPlan",
        playerId: "testv8-p2",
        availability: [{ id: "testv8-p2-late", from: 3, to: null }],
        effectiveRound: 1,
      },
    }, {
      id: "testv8-start",
      at: now + 540,
      actor,
      command: { type: "StartEvent" },
    }, {
      id: "testv8-confirm-p1",
      at: now + 541,
      actor,
      command: { type: "ConfirmPlayerSpan", playerId: "testv8-p1", spanId: "testv8-p1-morning" },
    }];
    const interim = fold(TEST_V8_EVENT_CODE, commands);
    if (interim.skipped.length > 0) {
      throw new Error(`Không dựng được sự kiện TESTV8: ${interim.skipped[0]!.error}`);
    }
    const schedule = planSchedule(interim.state, { mode: "extend", seed: 8080 });
    if (schedule.blocked) throw new Error(schedule.blocked);
    commands.push({
      id: "testv8-schedule",
      at: now + 542,
      actor,
      command: { type: "SetSchedule", fromRound: schedule.fromRound, matches: schedule.matches },
    });
    const committed = await events.commitMany(TEST_V8_EVENT_CODE, commands, {
      record,
      state: fold(TEST_V8_EVENT_CODE, []).state,
      repaired: false,
      skipped: [],
    });
    if (!committed.ok) throw new Error(committed.error);
    v8 = await events.load(TEST_V8_EVENT_CODE);
  }

  // TESTV9 có cả Phó Google, Phó device-only và một ô chưa nhận để thử link/QR.
  let v9 = await events.load(TEST_V9_EVENT_CODE);
  if (!v9) {
    const record = await events.create({
      code: TEST_V9_EVENT_CODE,
      clubId: club.id,
      name: "SÂN TEST V9 · TRAO QUYỀN",
      status: "draft",
      ownerUserId: "test-owner",
      playerPassHash: await hashPassword(TEST_PLAYER_PASSWORD),
      adminPassHash: await hashPassword(TEST_ADMIN_PASSWORD),
    }, now + 700);
    const actor = { kind: "admin", label: "Chủ sự kiện · TEST Trao quyền", ref: "test-owner" } as const;
    const members = loadedClub.members.filter((member) => member.status === "active").slice(0, 8);
    const commands: CommandEnvelope[] = [{
      id: "testv9-create", at: now + 700, actor,
      command: {
        type: "CreateEvent",
        code: TEST_V9_EVENT_CODE,
        clubId: club.id,
        config: { ...DEFAULT_CONFIG, name: "SÂN TEST V9 · TRAO QUYỀN", courts: 2 },
      },
    }, ...members.map((member, index) => ({
      id: `testv9-player-${index + 1}`,
      at: now + 710 + index,
      actor,
      command: {
        type: "AddPlayer" as const,
        player: {
          id: `testv9-p${index + 1}`,
          name: member.displayName,
          avatarId: member.avatarId,
          ...(index === 0 ? { userId: "test-google-user-1", deviceId: "testv9-device-1" } : {}),
          ...(index === 1 ? { userId: "g-testv9-guest", deviceId: "testv9-device-2" } : {}),
        },
        asActive: true,
      },
    })), {
      id: "testv9-start", at: now + 730, actor, command: { type: "StartEvent" },
    }];
    const interim = fold(TEST_V9_EVENT_CODE, commands);
    if (interim.skipped.length > 0) throw new Error(`Không dựng được TESTV9: ${interim.skipped[0]!.error}`);
    const schedule = planSchedule(interim.state, { mode: "extend", seed: 9090 });
    if (schedule.blocked) throw new Error(schedule.blocked);
    commands.push({
      id: "testv9-schedule", at: now + 731, actor,
      command: { type: "SetSchedule", fromRound: schedule.fromRound, matches: schedule.matches },
    });
    const committed = await events.commitMany(TEST_V9_EVENT_CODE, commands, {
      record,
      state: fold(TEST_V9_EVENT_CODE, []).state,
      repaired: false,
      skipped: [],
    });
    if (!committed.ok) throw new Error(committed.error);
    v9 = await events.load(TEST_V9_EVENT_CODE);
  }
  if ((await roles.list(TEST_V9_EVENT_CODE)).length === 0) {
    const roleActions: EventRoleAction[] = [{
      id: "testv9-role-google",
      eventCode: TEST_V9_EVENT_CODE,
      type: "grant-manager",
      roleId: "testv9-role-google",
      subject: { kind: "player", playerId: "testv9-p1", label: v9?.state.players[0]?.name ?? "Phó Google" },
      actorLabel: "Chủ sự kiện · TEST Trao quyền",
      actorRef: "test-owner",
      at: now + 740,
    }, {
      id: "testv9-role-device",
      eventCode: TEST_V9_EVENT_CODE,
      type: "grant-manager",
      roleId: "testv9-role-device",
      subject: { kind: "player", playerId: "testv9-p2", label: v9?.state.players[1]?.name ?? "Phó thiết bị" },
      actorLabel: "Chủ sự kiện · TEST Trao quyền",
      actorRef: "test-owner",
      at: now + 741,
    }, {
      id: "testv9-role-pending",
      eventCode: TEST_V9_EVENT_CODE,
      type: "grant-manager",
      roleId: "testv9-role-pending",
      inviteId: "testv9-invite-p3",
      tokenHash: hashRoleInvitation("testv9-token-p3"),
      expiresAt: now + 365 * 24 * 60 * 60 * 1000,
      subject: { kind: "player", playerId: "testv9-p3", label: v9?.state.players[2]?.name ?? "Phó chờ nhận" },
      actorLabel: "Chủ sự kiện · TEST Trao quyền",
      actorRef: "test-owner",
      at: now + 742,
    }];
    await roles.appendMany(roleActions);
  }

  console.log(`Đã giữ dữ liệu TEST tại: ${path}`);
  console.log(`CLB: ${club.name} · mã mời ${club.inviteCode}`);
  console.log(`Sân/sự kiện: ${event?.state.config.name ?? TEST_EVENT_CODE} · mã ${TEST_EVENT_CODE}`);
  console.log(`Trưng bày v0.5: ${v5?.state.config.name ?? TEST_V5_EVENT_CODE} · mã ${TEST_V5_EVENT_CODE}`);
  console.log(`Điều hành v0.6: ${v6?.state.config.name ?? TEST_V6_EVENT_CODE} · mã ${TEST_V6_EVENT_CODE}`);
  console.log(`Linh động v0.8: ${v8?.state.config.name ?? TEST_V8_EVENT_CODE} · mã ${TEST_V8_EVENT_CODE}`);
  console.log(`Trao quyền v0.9: ${v9?.state.config.name ?? TEST_V9_EVENT_CODE} · mã ${TEST_V9_EVENT_CODE}`);
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
