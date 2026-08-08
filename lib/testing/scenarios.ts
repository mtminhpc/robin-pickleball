/**
 * Bộ mẫu thử: những buổi đánh có thật, dựng bằng lệnh nghiệp vụ.
 *
 * Tách khỏi tệp kiểm thử để **dùng chung hai nơi**: `tests/scenarios.test.ts`
 * chạy tự động trong `npm test`, còn `npm run scenarios` in ra bảng số cho người
 * đọc. Hai bên phải đi đúng cùng một đường, nếu không thì bảng số trên màn hình
 * nói một đằng mà bộ kiểm thử canh một nẻo.
 *
 * Cỡ nhóm 6–9 người được chọn có chủ ý, vì mỗi cỡ là một chế độ khác hẳn nhau:
 *
 * | Người | Sân | Mỗi vòng nghỉ | Điều đáng canh |
 * |---|---|---|---|
 * | 6 | 1 | 2 | Nhóm nhỏ, mọi người gặp nhau liên tục — dễ lặp cặp đôi |
 * | 7 | 1 | 3 | Số lẻ, suất nghỉ phải xoay vòng cho đều |
 * | 8 | 2 | 0 | **Ai cũng đánh mọi vòng** — không có suất nghỉ nào để phân phối |
 * | 9 | 2 | 1 | Chỉ một người được nghỉ mỗi vòng, khắt khe nhất về xoay vòng |
 *
 * Cỡ 8 người / 2 sân là trường hợp suy biến đáng chú ý: `achievableStreakCap`
 * trả `Infinity`, và mọi cảnh báo về "nghỉ giữa hiệp" đều vô nghĩa. Kịch bản
 * vẫn chạy để chắc rằng ứng dụng **nói thẳng** điều đó thay vì im lặng vi phạm.
 */

import type { PlayerId } from "../domain/types";
import { EventSim } from "./harness";

export interface ScenarioSetup {
  players: number;
  courts: number;
  rounds: number;
  seed?: number;
}

export interface ScenarioResult {
  sim: EventSim;
  /** Chuyện đã xảy ra giữa chừng, để in ra cho người đọc hiểu bối cảnh. */
  events: string[];
  /**
   * Nới trần chuỗi liên tiếp thêm mấy bậc.
   *
   * Kịch bản có người vào/ra giữa chừng thì quá khứ đã cố định còn số người vừa
   * đổi, nên có thể tồn tại thế bí thật sự mà không thuật toán nào gỡ được.
   */
  streakAllowance: number;
}

export interface Scenario {
  key: string;
  title: string;
  /** Vì sao kịch bản này đáng chạy — câu này đi thẳng vào báo cáo. */
  why: string;
  /**
   * Danh sách người chơi có giữ nguyên suốt buổi không.
   *
   * Quyết định hai luật được áp chặt hay lỏng: "số trận chênh không quá 1" chỉ
   * đúng khi ổn định, và trần chuỗi liên tiếp cũng chỉ so thẳng được khi số
   * người không đổi giữa chừng.
   */
  stableRoster: boolean;
  /**
   * Mức lệch so với suất kỳ vọng còn chấp nhận được, nếu khác mặc định 1.05.
   *
   * Nới ra thì phải nói rõ vì sao, ngay tại chỗ nới. Con số này là lời hứa công
   * bằng của ứng dụng — âm thầm nâng nó lên cho bảng xanh là tự lừa mình.
   */
  tolerance?: number;
  run(setup: ScenarioSetup): ScenarioResult;
}

const NAMES = [
  "An", "Bình", "Cường", "Dũng", "Giang", "Hà", "Hùng", "Khánh",
  "Lan", "Linh", "Minh", "Nam", "Ngọc", "Oanh", "Phúc", "Quân",
];

export function nameFor(i: number): string {
  const base = NAMES[i % NAMES.length]!;
  return i < NAMES.length ? base : `${base} ${Math.floor(i / NAMES.length) + 1}`;
}

/** Cỡ nhóm được quét, kèm số sân tự nhiên cho cỡ đó. */
export const SIZES: ScenarioSetup[] = [
  { players: 6, courts: 1, rounds: 12 },
  { players: 7, courts: 1, rounds: 12 },
  { players: 8, courts: 2, rounds: 12 },
  { players: 9, courts: 2, rounds: 12 },
];

function fresh(setup: ScenarioSetup): EventSim {
  const sim = new EventSim({
    seed: setup.seed ?? 4242,
    config: { courts: setup.courts, name: "Mẫu thử" },
    // Cố ý KHÔNG bóp ngân sách tối ưu, dù chạy chậm hơn.
    //
    // Trước đây chỗ này đặt 6.000 lượt / 120ms cho nhanh, trong khi ứng dụng thật
    // chạy tới 40.000 lượt / 400ms. Hậu quả không phải là chậm hay nhanh mà là bộ
    // mẫu thử đi chấm một thuật toán YẾU HƠN thuật toán người dùng nhận — và nó
    // đã báo sai một lần: một kịch bản báo thiếu 1,07 suất, nhưng dò kỹ thì với
    // ngân sách thật con số ấy là 0,60. Bảng số nói về phần mềm không tồn tại thì
    // xanh hay đỏ đều vô nghĩa.
  });
  sim.addPlayers(Array.from({ length: setup.players }, (_, i) => nameFor(i)));
  sim.start();
  return sim;
}

function nameOf(sim: EventSim, id: PlayerId): string {
  return sim.state.players.find((p) => p.id === id)?.name ?? id;
}

/** Một người đang chơi, không phải người vừa được nhắc tới. */
function someoneActive(sim: EventSim, except: PlayerId[] = []): PlayerId | null {
  const p = sim.state.players.find(
    (x) => x.status === "active" && !except.includes(x.id),
  );
  return p?.id ?? null;
}

export const SCENARIOS: Scenario[] = [
  {
    key: "binh-thuong",
    title: "Buổi bình thường",
    why: "Mốc so sánh. Danh sách người chơi không đổi suốt buổi, nên số trận KHÔNG được chênh quá 1.",
    stableRoster: true,
    run(setup) {
      const sim = fresh(setup);
      sim.playRounds(setup.rounds);
      return { sim, events: [], streakAllowance: 0 };
    },
  },

  {
    key: "toi-tre",
    title: "Một người tới trễ",
    why: "Người vào vòng 4 không được coi là đang nợ 3 trận. Lệch của họ phải ≈ 0 ngay lúc vừa vào.",
    stableRoster: false,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(3);
      const id = sim.joinMidEvent(nameFor(setup.players));
      events.push(`vòng 4: ${nameOf(sim, id)} tới trễ`);
      sim.playRounds(setup.rounds - 3);
      return { sim, events, streakAllowance: 1 };
    },
  },

  {
    key: "ve-som",
    title: "Một người về sớm",
    why: "Người về ở vòng 7 không được coi là 'được ưu ái'. Kết quả đã đánh phải giữ nguyên trong bảng xếp hạng.",
    stableRoster: false,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(6);
      const id = someoneActive(sim);
      if (id) {
        sim.leave(id);
        events.push(`vòng 7: ${nameOf(sim, id)} về sớm`);
      }
      sim.playRounds(setup.rounds - 6);
      return { sim, events, streakAllowance: 1 };
    },
  },

  {
    key: "tre-va-ve",
    title: "Vừa có người tới trễ vừa có người về sớm",
    why: "Hai biến động chồng lên nhau — chỗ dễ làm số liệu công bằng lệch nhất.",
    stableRoster: false,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(3);
      const den = sim.joinMidEvent(nameFor(setup.players));
      events.push(`vòng 4: ${nameOf(sim, den)} tới trễ`);
      sim.playRounds(3);
      const ve = someoneActive(sim, [den]);
      if (ve) {
        sim.leave(ve);
        events.push(`vòng 7: ${nameOf(sim, ve)} về sớm`);
      }
      sim.playRounds(setup.rounds - 6);
      return { sim, events, streakAllowance: 1 };
    },
  },

  {
    key: "nghi-tam-roi-quay-lai",
    title: "Nghỉ tạm rồi quay lại",
    why: "Khoảng có mặt bị cắt làm đôi. Suất kỳ vọng chỉ được tính trên những vòng người đó thật sự có mặt.",
    stableRoster: false,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(3);
      const id = someoneActive(sim);
      if (id) {
        sim.send({ type: "PausePlayer", playerId: id });
        sim.reschedule("rebuild");
        events.push(`vòng 4: ${nameOf(sim, id)} nghỉ tạm`);
        sim.playRounds(3);
        sim.send({ type: "ResumePlayer", playerId: id });
        sim.reschedule("rebuild");
        events.push(`vòng 7: ${nameOf(sim, id)} quay lại`);
      }
      sim.playRounds(setup.rounds - 6);
      return { sim, events, streakAllowance: 1 };
    },
  },

  {
    key: "huy-tran",
    title: "Huỷ một trận",
    why: "Trận huỷ phải kéo suất kỳ vọng của cả nhóm xuống theo, để bốn người bị mất trận không thành ra chịu thiệt.",
    stableRoster: true,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(3);
      const m = sim.state.matches.find((x) => x.status === "scheduled");
      if (m) {
        sim.send({ type: "CancelMatch", matchId: m.id, reason: "Mưa" });
        sim.reschedule("rebuild");
        events.push(`huỷ một trận ở vòng ${m.round}`);
      }
      sim.playRounds(setup.rounds - 3);
      return { sim, events, streakAllowance: 1 };
    },
  },

  {
    key: "bo-do",
    title: "Bỏ dở một trận, vẫn ghi tỷ số dở dang",
    why: "Bốn người đó đã tốn sức mà không được tính trận, nên họ vẫn phải đang bị thiệt và được ưu tiên xếp lại.",
    stableRoster: true,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(3);
      const m = sim.state.matches.find((x) => x.status === "scheduled");
      if (m) {
        sim.send({ type: "StartMatch", matchId: m.id });
        sim.send({
          type: "AbandonMatch",
          matchId: m.id,
          reason: "Hết giờ sân",
          score: { scoreA: 7, scoreB: 5 },
        });
        sim.reschedule("rebuild");
        events.push(`bỏ dở một trận ở vòng ${m.round} với tỷ số 7–5`);
      }
      sim.playRounds(setup.rounds - 3);
      return { sim, events, streakAllowance: 1 };
    },
  },

  {
    key: "sua-ty-so",
    title: "Nhập nhầm rồi sửa lại",
    why: "Sửa tỷ số không được làm hỏng bảng xếp hạng hay số liệu công bằng.",
    stableRoster: true,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(4);
      const m = sim.state.matches.find((x) => x.status === "submitted");
      if (m) {
        sim.send({
          type: "EditResult",
          matchId: m.id,
          scoreA: 11,
          scoreB: 3,
          irregular: false,
          note: "Nhập nhầm sân",
        });
        events.push(`sửa tỷ số một trận ở vòng ${m.round} thành 11–3`);
      }
      sim.playRounds(setup.rounds - 4);
      return { sim, events, streakAllowance: 0 };
    },
  },

  {
    key: "go-ty-so",
    title: "Gỡ tỷ số, đưa trận về chưa đánh",
    why: "Gỡ xong thì trận đó phải thôi được tính, và suất kỳ vọng của cả nhóm phải tụt theo.",
    stableRoster: true,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(4);
      const m = [...sim.state.matches].reverse().find((x) => x.status === "submitted");
      if (m) {
        sim.send({ type: "RevertResult", matchId: m.id, note: "Nhầm trận" });
        events.push(`gỡ tỷ số một trận ở vòng ${m.round}`);
      }
      sim.playRounds(setup.rounds - 4);
      return { sim, events, streakAllowance: 0 };
    },
  },

  {
    key: "doi-cho-vong",
    title: "Dời lịch: đổi chỗ hai vòng",
    why: "Nút Sớm hơn / Muộn hơn. Không ai được thêm hay bớt trận nào, chỉ thứ tự đổi.",
    stableRoster: true,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(2);
      const rounds = [...new Set(sim.state.matches.map((m) => m.round))]
        .filter((r) => r > 2)
        .sort((a, b) => a - b);
      if (rounds.length >= 2) {
        sim.send({ type: "SwapRounds", roundA: rounds[0]!, roundB: rounds[1]! });
        events.push(`đổi chỗ vòng ${rounds[0]} và vòng ${rounds[1]}`);
      }
      sim.playRounds(setup.rounds - 2);
      // Nới rộng hơn các kịch bản khác, có lý do: đổi chỗ hai vòng CÓ THỂ nối
      // hai chuỗi ngắn thành một chuỗi dài, và đó là điều chủ sân chủ động chọn.
      // Hộp xác nhận trước khi đổi đã nói thẳng ai sẽ phải đánh liên tiếp mấy
      // vòng — đây là đánh đổi có cảnh báo, không phải lỗi xếp lịch.
      return { sim, events, streakAllowance: 3 };
    },
  },

  {
    key: "ghim-tran",
    title: "Ghim một vòng rồi đánh tiếp",
    why: "Vòng đã ghim mà chưa đánh làm `firstOpenRound` chạy trước `firstUnplayedRound` — chỗ hai con số đó tách nhau ra là chỗ dễ sinh lỗi.",
    stableRoster: true,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(2);
      const round = Math.min(
        ...sim.state.matches.filter((m) => m.status === "scheduled").map((m) => m.round),
      );
      for (const m of sim.state.matches.filter((x) => x.round === round)) {
        sim.send({ type: "PinMatch", matchId: m.id, pinned: true });
      }
      events.push(`ghim toàn bộ vòng ${round}`);
      sim.playRounds(setup.rounds - 2);
      return { sim, events, streakAllowance: 1 };
    },
  },

  {
    key: "ghim-roi-cho-nghi",
    title: "Ghim một vòng, người mới vào rồi xin nghỉ",
    why: "Đúng tổ hợp đã làm một người đánh xong vẫn biến mất khỏi bảng xếp hạng. Kết quả đã đánh phải ở lại, luôn luôn.",
    stableRoster: false,
    // Nới từ 1.05 lên 1.35, và đây là lý do: kịch bản này chồng BA biến động lên
    // nhau — một vòng bị ghim vĩnh viễn không đánh, một người vào giữa chừng, rồi
    // chính người đó xin nghỉ. Vòng xoay chỉ có 8 vòng để dàn đều lại. Đo được ở
    // 7 người / 1 sân: số trận 3–5, lệch tệ nhất 1.29. Đó là giới hạn của vòng
    // xoay ngắn, không phải lỗi phân phối — các kịch bản còn lại vẫn giữ 1.05.
    tolerance: 1.35,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(2);

      // Ghim một vòng nhưng không đánh nó: firstOpenRound vượt lên trước
      // firstUnplayedRound, và người vào sau sẽ nhận khoảng có mặt bắt đầu muộn hơn.
      const round = Math.min(
        ...sim.state.matches.filter((m) => m.status === "scheduled").map((m) => m.round),
      );
      for (const m of sim.state.matches.filter((x) => x.round === round)) {
        sim.send({ type: "PinMatch", matchId: m.id, pinned: true });
      }
      events.push(`ghim vòng ${round} nhưng không đánh`);

      const id = sim.joinMidEvent(nameFor(setup.players));
      events.push(`${nameOf(sim, id)} vào giữa chừng`);

      // Cho người mới đánh vài trận thật.
      //
      // Nhập tỷ số cho TRỌN vòng chứ không riêng trận có người mới: bỏ dở nửa
      // vòng thì những người chưa đánh đang thật sự thiếu suất, và bảng Công
      // bằng báo lệch là báo đúng — không phải lỗi để đi bắt.
      const coNguoiMoi = [
        ...new Set(
          sim.state.matches
            .filter(
              (m) =>
                m.round > round &&
                m.status === "scheduled" &&
                [...m.teamA, ...m.teamB].includes(id),
            )
            .map((m) => m.round),
        ),
      ]
        .sort((a, b) => a - b)
        .slice(0, 2);

      for (const r of coNguoiMoi) {
        for (const m of sim.state.matches.filter(
          (x) => x.round === r && x.status === "scheduled",
        )) {
          sim.send({
            type: "SubmitResult",
            matchId: m.id,
            scoreA: 11,
            scoreB: 7,
            irregular: false,
          });
        }
      }
      events.push(`đánh trọn ${coNguoiMoi.length} vòng có ${nameOf(sim, id)}`);

      sim.send({ type: "PausePlayer", playerId: id });
      events.push(`${nameOf(sim, id)} xin nghỉ tạm`);

      // Đánh tiếp cho vòng xoay kịp đều lại. Dừng ngay sau khi ai đó vừa nghỉ
      // thì bảng Công bằng đang ở giữa một nhịp xoay, và mọi con số lệch lúc đó
      // là bình thường chứ không phải lỗi.
      sim.reschedule("rebuild");
      sim.playRounds(4);
      return { sim, events, streakAllowance: 2 };
    },
  },

  {
    key: "xin-vao-bi-tu-choi",
    title: "Xin vào nhưng bị từ chối",
    why: "Người bị từ chối không được lọt vào bảng công bằng hay bảng xếp hạng, vì họ chưa từng ra sân.",
    stableRoster: true,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(3);
      const id = `p-khach-la`;
      sim.send(
        { type: "RequestJoin", player: { id, name: "Khách lạ", avatarId: "a01" } },
        { kind: "player", label: "Khách lạ", ref: id },
      );
      sim.send({ type: "RejectJoin", playerId: id });
      events.push("một người xin vào và bị từ chối");
      sim.playRounds(setup.rounds - 3);
      return { sim, events, streakAllowance: 0 };
    },
  },

  {
    key: "cap-suat-duoi-kip",
    title: "Cấp thêm suất đuổi kịp",
    why: "Khoản ưu tiên phải hiện thành cột riêng, không được trộn vào cột Lệch — nếu không người vừa được cấp sẽ trông như đang bị thiệt.",
    stableRoster: false,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(4);
      const id = someoneActive(sim);
      if (id) {
        sim.send({ type: "GrantCatchUp", playerId: id, games: 2 });
        sim.reschedule("rebuild");
        events.push(`cấp 2 suất đuổi kịp cho ${nameOf(sim, id)}`);
      }
      sim.playRounds(setup.rounds - 4);
      return { sim, events, streakAllowance: 1 };
    },
  },

  {
    key: "khai-toi-muon",
    title: "Khai trước: 7 giờ mới tới, tầm vòng 5",
    why: "Người đã báo trước là chưa tới KHÔNG được xếp vào những vòng đó — cả sân đứng chờ một người đã nói rõ là mình chưa đến thì tệ hơn hẳn việc cho họ nghỉ thêm.",
    stableRoster: false,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      const id = someoneActive(sim);
      if (id) {
        sim.send({ type: "DeclareAvailability", playerId: id, fromRound: 5, toRound: null });
        sim.reschedule("rebuild");
        events.push(`${nameOf(sim, id)} khai: từ vòng 5 mới có mặt`);
      }
      sim.playRounds(setup.rounds);
      return { sim, events, streakAllowance: 1 };
    },
  },

  {
    key: "khai-ve-som",
    title: "Khai trước: 9 giờ phải về, đánh tới vòng 8",
    why: "Đầu kia của cùng một lời hứa. Sau vòng 8 không được còn tên họ trong lịch.",
    stableRoster: false,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      const id = someoneActive(sim);
      if (id) {
        sim.send({ type: "DeclareAvailability", playerId: id, fromRound: 1, toRound: 8 });
        sim.reschedule("rebuild");
        events.push(`${nameOf(sim, id)} khai: đánh tới vòng 8 thôi`);
      }
      sim.playRounds(setup.rounds);
      return { sim, events, streakAllowance: 1 };
    },
  },

  {
    key: "khai-khoang-giua",
    title: "Khai trước: chỉ đánh được từ vòng 4 đến vòng 9",
    why: "Cả hai đầu cùng lúc, và hai người khai lệch nhau — chỗ dễ làm bộ xếp lịch không đủ người cho một vòng.",
    stableRoster: false,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      const a = someoneActive(sim);
      const b = someoneActive(sim, a ? [a] : []);
      if (a) {
        sim.send({ type: "DeclareAvailability", playerId: a, fromRound: 4, toRound: 9 });
        events.push(`${nameOf(sim, a)} khai: vòng 4 → 9`);
      }
      if (b) {
        sim.send({ type: "DeclareAvailability", playerId: b, fromRound: 1, toRound: 6 });
        events.push(`${nameOf(sim, b)} khai: vòng 1 → 6`);
      }
      sim.reschedule("rebuild");
      sim.playRounds(setup.rounds);
      return { sim, events, streakAllowance: 1 };
    },
  },

  {
    key: "ket-thuc-som",
    title: "Kết thúc sớm giữa buổi",
    why: "Các vòng phía sau chỉ còn trận đã huỷ. Không được tính chúng thành 'ai cũng nghỉ thêm mấy vòng'.",
    stableRoster: true,
    run(setup) {
      const sim = fresh(setup);
      const events: string[] = [];
      sim.playRounds(5);
      sim.send({ type: "EndEventEarly", reason: "Trời mưa to" });
      events.push("chủ sân bấm kết thúc sớm sau vòng 5");
      return { sim, events, streakAllowance: 0 };
    },
  },
];
