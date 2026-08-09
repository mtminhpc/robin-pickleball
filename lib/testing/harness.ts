/**
 * Bộ khung chạy thử một sự kiện từ đầu tới cuối bằng lệnh, không cần giao diện
 * hay Google Sheet.
 *
 * Dùng chung cho bộ kiểm thử và cho công cụ mô phỏng dòng lệnh, nên hai bên luôn
 * chạy đúng cùng một đường đi mà ứng dụng thật sẽ chạy: mọi thay đổi đều đi qua
 * `apply`, mọi lịch đều do `planSchedule` sinh ra.
 */

import type { Command, CommandEnvelope } from "../domain/commands";
import { apply } from "../domain/reduce";
import { emptyState } from "../domain/reduce";
import { firstUnplayedRound } from "../domain/rounds";
import type { Actor, EventConfig, EventState, PlayerId } from "../domain/types";
import { DEFAULT_CONFIG } from "../domain/types";
import { planSchedule, type PlanMode, type PlanOptions } from "../scheduler/plan";
import { makeRng, type Rng } from "../scheduler/rng";

const ADMIN: Actor = { kind: "admin", label: "chủ sân", ref: "admin" };

export interface SimOptions {
  code?: string;
  config?: Partial<EventConfig>;
  seed?: number;
  /** Tham số truyền thẳng cho bộ xếp lịch, để test chạy nhanh hơn. */
  planning?: Pick<PlanOptions, "iterations" | "timeBudgetMs">;
}

export class EventSim {
  state: EventState;
  readonly log: CommandEnvelope[] = [];
  readonly rng: Rng;
  /** Trình độ ẩn của từng người, chỉ dùng để sinh tỷ số giả cho có nghĩa. */
  readonly skill = new Map<PlayerId, number>();

  private clock = 1_700_000_000_000;
  private counter = 0;
  private readonly planning: SimOptions["planning"];

  constructor(opts: SimOptions = {}) {
    const code = opts.code ?? "SIM001";
    this.rng = makeRng(opts.seed ?? 12345);
    this.planning = opts.planning;
    this.state = emptyState(code);
    this.send({
      type: "CreateEvent",
      code,
      clubId: null,
      config: { ...DEFAULT_CONFIG, ...opts.config },
    });
  }

  // -- hạ tầng ------------------------------------------------------------

  /** Gửi một lệnh. Ném lỗi nếu bị từ chối, để test không âm thầm bỏ qua. */
  send(command: Command, actor: Actor = ADMIN): EventState {
    const envelope: CommandEnvelope = {
      id: `c${++this.counter}`,
      at: (this.clock += 1000),
      actor,
      command,
    };
    const result = apply(this.state, envelope);
    if (!result.ok) {
      throw new Error(`${command.type} bị từ chối: ${result.error}`);
    }
    this.log.push(envelope);
    this.state = result.value;
    return this.state;
  }

  /** Gửi lệnh và trả về lỗi thay vì ném — dùng khi test chính chuyện bị từ chối. */
  trySend(command: Command, actor: Actor = ADMIN): string | null {
    const envelope: CommandEnvelope = {
      id: `c${++this.counter}`,
      at: (this.clock += 1000),
      actor,
      command,
    };
    const result = apply(this.state, envelope);
    if (!result.ok) return result.error;
    this.log.push(envelope);
    this.state = result.value;
    return null;
  }

  // -- người chơi ---------------------------------------------------------

  addPlayers(names: string[]): PlayerId[] {
    return names.map((name) => this.addPlayer(name));
  }

  addPlayer(name: string, opts: { asActive?: boolean } = {}): PlayerId {
    const id = `p-${name.toLowerCase().replace(/\s+/g, "-")}-${this.counter}`;
    this.skill.set(id, this.rng.next() * 6 - 3);
    this.send({
      type: "AddPlayer",
      player: { id, name, avatarId: "a01" },
      asActive: opts.asActive ?? true,
    });
    return id;
  }

  /** Thêm người sau khi sự kiện đã bắt đầu, đi qua đúng luồng xin duyệt. */
  joinMidEvent(name: string): PlayerId {
    const id = `p-${name.toLowerCase().replace(/\s+/g, "-")}-${this.counter}`;
    this.skill.set(id, this.rng.next() * 6 - 3);
    this.send(
      { type: "RequestJoin", player: { id, name, avatarId: "a01" } },
      { kind: "player", label: name, ref: id },
    );
    this.send({ type: "ApproveJoin", playerId: id });
    this.reschedule("rebuild");
    return id;
  }

  leave(playerId: PlayerId): void {
    this.send({ type: "PlayerLeft", playerId });
    this.reschedule("rebuild");
  }

  // -- vòng đời -----------------------------------------------------------

  start(): void {
    this.send({ type: "StartEvent" });
    this.reschedule("extend");
  }

  /** Sinh hoặc xếp lại lịch, đúng như máy chủ sẽ làm sau mỗi thay đổi. */
  reschedule(mode: PlanMode = "extend"): void {
    const outcome = planSchedule(this.state, { mode, ...this.planning });
    if (outcome.blocked) return;
    if (outcome.matches.length === 0) return;
    this.send({
      type: "SetSchedule",
      fromRound: outcome.fromRound,
      matches: outcome.matches,
    });
  }

  /** Đánh xong vòng còn dở sớm nhất. Trả về số vòng vừa đánh, 0 nếu hết lịch. */
  playNextRound(): number {
    // Phải đi theo vòng người dùng thực sự nhìn thấy. `firstOpenRound` là mốc
    // dành cho thuật toán và sẽ nhảy qua trận đã ghim; dùng nó ở đây khiến mô
    // phỏng không bao giờ đánh các vòng admin vừa đổi/ghim.
    const round = firstUnplayedRound(this.state);
    const matches = this.state.matches.filter(
      (m) => m.round === round && m.status === "scheduled",
    );
    if (matches.length === 0) return 0;

    for (const m of matches) {
      const [scoreA, scoreB] = this.simulateScore(m.teamA, m.teamB);
      this.send(
        {
          type: "SubmitResult",
          matchId: m.id,
          scoreA,
          scoreB,
          irregular: false,
        },
        { kind: "player", label: "người nhập", ref: m.teamA[0] },
      );
    }
    this.reschedule("extend");
    return round;
  }

  /** Chạy nhiều vòng liền. Dừng sớm nếu hết lịch. */
  playRounds(count: number): number {
    let played = 0;
    for (let i = 0; i < count; i++) {
      if (this.playNextRound() === 0) break;
      played += 1;
    }
    return played;
  }

  /**
   * Sinh tỷ số giả từ chênh lệch trình độ hai đội.
   * Không cần thực tế, chỉ cần bảng xếp hạng có thứ tự nhìn ra được quy luật.
   */
  private simulateScore(
    teamA: readonly [PlayerId, PlayerId],
    teamB: readonly [PlayerId, PlayerId],
  ): [number, number] {
    const target = this.state.config.scoring.pointsTo;
    const sa = (this.skill.get(teamA[0]) ?? 0) + (this.skill.get(teamA[1]) ?? 0);
    const sb = (this.skill.get(teamB[0]) ?? 0) + (this.skill.get(teamB[1]) ?? 0);
    const edge = sa - sb + (this.rng.next() * 4 - 2);

    // Đội mạnh hơn thắng; chênh lệch trình độ càng lớn thì tỷ số càng cách biệt.
    const margin = Math.min(target, Math.max(1, Math.round(Math.abs(edge))));
    const loser = Math.max(0, target - margin);
    return edge >= 0 ? [target, loser] : [loser, target];
  }
}
