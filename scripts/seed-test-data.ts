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

export const TEST_DATA_PATH = resolve(
  process.env.ROBIN_TEST_DATA_PATH ?? ".data/test-sandbox.json",
);
export const TEST_EVENT_CODE = "TEST11";
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

  console.log(`Đã giữ dữ liệu TEST tại: ${path}`);
  console.log(`CLB: ${club.name} · mã mời ${club.inviteCode}`);
  console.log(`Sân/sự kiện: ${event?.state.config.name ?? TEST_EVENT_CODE} · mã ${TEST_EVENT_CODE}`);
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
