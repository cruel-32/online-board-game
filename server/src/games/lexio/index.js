'use strict';
/**
 * 렉시오 게임 엔진 (플러그인).
 * rooms.js(게임 독립 오케스트레이터)가 아래 인터페이스를 통해 게임을 구동한다.
 * 렉시오의 "매치"는 여러 라운드로 이뤄지며, 칩은 room.players[].chips 에 라운드 간 유지된다.
 */
const { Game } = require('./game');
const { chooseBotMove } = require('./bot');

const DEFAULT_CHIPS = 50; // 기본 지급 칩(최소값). 방장이 10개 단위로 늘릴 수 있음

function normalizeChips(v) {
  const n = Math.round(Number(v) / 10) * 10;
  return Number.isFinite(n) && n >= 50 ? n : DEFAULT_CHIPS;
}

module.exports = {
  meta: {
    id: 'lexio',
    name: '렉시오',
    minPlayers: 3,
    maxPlayers: 5,
    settleDelay: 2200, // 마지막 패를 낸 상태를 잠시 보여준 뒤 정산
  },

  defaultOptions() {
    return { chips: DEFAULT_CHIPS };
  },
  normalizeOptions(opts) {
    return { chips: normalizeChips(opts && opts.chips) };
  },

  // 플레이어가 방에 들어오거나 옵션이 바뀔 때 개별 경제(칩) 초기화
  initPlayer(room, player) {
    player.chips = room.options.chips;
  },
  // 새 매치 시작 시 전원 칩 초기화
  resetMatch(room) {
    for (const p of room.players) p.chips = room.options.chips;
  },

  createGame(room) {
    return new Game(room.players);
  },

  currentActor(game) {
    return game.finished ? null : game.currentPlayerId();
  },

  botDelay() {
    return 900 + Math.random() * 900;
  },

  applyAction(game, room, playerId, action) {
    const kind = action && action.kind;
    if (kind === 'play') {
      const r = game.play(playerId, action.tileIds || []);
      return { ended: !!r.finished };
    }
    if (kind === 'pass') {
      game.pass(playerId);
      return { ended: false };
    }
    throw new Error('알 수 없는 동작입니다.');
  },

  botAction(game, playerId) {
    const mv = chooseBotMove(game, playerId);
    return mv.action === 'play'
      ? { kind: 'play', tileIds: mv.tileIds }
      : { kind: 'pass' };
  },

  serialize(game, room, viewerId) {
    const g = game;
    const nameOf = (id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : '?';
    };
    return {
      gameId: 'lexio',
      roomId: room.id,
      roomName: room.name,
      roundNo: room.roundNo,
      maxN: g.maxN,
      you: viewerId,
      players: room.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot,
        connected: p.connected, chips: p.chips,
        tileCount: g.hands.get(p.id).length,
        passed: g.passed.has(p.id),
        inVoice: !!p.inVoice, micMuted: !!p.micMuted,
      })),
      turnId: g.currentPlayerId(),
      leaderId: g.leaderId,
      table: g.current
        ? {
            tiles: g.current.combo.tiles,
            combo: { type: g.current.combo.type, count: g.current.combo.count, rank: g.current.combo.rank },
            byId: g.current.byId,
            byName: nameOf(g.current.byId),
          }
        : null,
      hand: g.hands.get(viewerId) || [],
      finished: g.finished,
      winnerId: g.winnerId,
    };
  },

  // 대기실 좌석 부가표시
  seatLabel(room, player) {
    return `● ${player.chips}점`;
  },

  /**
   * 라운드 종료 정산. room.players[].chips 갱신, matchOver 판정.
   * 반환: { payload(결과), continues(true=다음 라운드 대기, false=매치 종료) }
   */
  settle(game, room) {
    const g = game;
    const res = g.results(); // [{id, remaining, twos, eff, tiles}]
    const sorted = res.slice().sort((a, b) => a.eff - b.eff);
    const rankOf = new Map();
    sorted.forEach((r, i) => {
      const prev = i > 0 ? sorted[i - 1] : null;
      rankOf.set(r.id, prev && prev.eff === r.eff ? rankOf.get(prev.id) : i + 1);
    });

    const chipsOf = new Map(room.players.map((p) => [p.id, p.chips]));
    const delta = new Map(res.map((r) => [r.id, 0]));

    // 모든 쌍: 남은 타일이 많은 쪽이 차이만큼 지불(칩 잔액 한도)
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const win = sorted[i], lose = sorted[j];
        const diff = lose.eff - win.eff;
        if (diff <= 0) continue;
        const pay = Math.min(chipsOf.get(lose.id), diff);
        if (pay <= 0) continue;
        chipsOf.set(lose.id, chipsOf.get(lose.id) - pay);
        chipsOf.set(win.id, chipsOf.get(win.id) + pay);
        delta.set(lose.id, delta.get(lose.id) - pay);
        delta.set(win.id, delta.get(win.id) + pay);
      }
    }

    for (const p of room.players) p.chips = chipsOf.get(p.id);
    const busted = room.players.filter((p) => p.chips <= 0);
    const matchOver = busted.length > 0;
    room.matchOver = matchOver;

    const rows = res
      .map((r) => {
        const p = room.players.find((x) => x.id === r.id);
        return {
          id: r.id,
          name: p.name,
          isBot: p.isBot,
          rank: rankOf.get(r.id),
          remaining: r.remaining,
          twos: r.twos,
          eff: r.eff,
          delta: delta.get(r.id),
          chips: p.chips,
        };
      })
      .sort((a, b) => a.rank - b.rank);

    const payload = {
      gameId: 'lexio',
      roundNo: room.roundNo,
      rows,
      matchOver,
      bustedNames: busted.map((b) => b.name),
    };
    return { payload, continues: !matchOver };
  },
};
