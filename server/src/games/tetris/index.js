'use strict';
/**
 * 테트리스 게임 엔진(플러그인) — 배틀로얄(가비지 공격, 최후 생존).
 * rooms.js(게임 독립 오케스트레이터)가 이 인터페이스를 통해 게임을 구동한다.
 *
 * 다른 게임들과 달리 "차례" 개념이 없다: currentActor는 항상 null을 반환해
 * rooms.js의 봇 자동 진행 스케줄러(scheduleBotTurn)가 자연히 아무 일도 하지 않게 한다.
 * 실제 진행(중력·충돌·회전)은 각 클라이언트가 로컬에서 시뮬레이션하고, 조각이 고정될 때마다
 * game_action으로 결과만 보고한다 — 그래서 이 엔진은 서버 쪽 tick(주기적 갱신)이 필요 없다.
 *
 * v1은 봇을 지원하지 않는다(meta.noBots) — 실시간 판단이 필요한 테트리스 봇은
 * 카드게임 봇과 난이도가 다르므로 1차 스코프에서 제외했다. 연결이 끊긴 플레이어는
 * (봇으로 전환하는 다른 게임들과 달리) handleDisconnect로 즉시 탈락 처리한다.
 */
const { Game } = require('./game');

module.exports = {
  meta: {
    id: 'tetris',
    name: '테트리스',
    minPlayers: 2,
    maxPlayers: 4,
    settleDelay: 2500,
    noBots: true, // 대기실에서 "봇 추가"를 막는다(rooms.js가 이 플래그를 확인)
  },

  defaultOptions() { return {}; },
  normalizeOptions() { return {}; },
  initPlayer() {},  // 대기실 단계엔 게임별 경제가 없음
  resetMatch() {},

  createGame(room) {
    return new Game(room.players);
  },

  // 차례 개념이 없는 실시간 게임 — 항상 null(= 봇 자동 진행 스케줄러가 개입하지 않음)
  currentActor() { return null; },
  botDelay() { return 99999; },
  botAction() { throw new Error('테트리스는 봇을 지원하지 않습니다.'); },

  applyAction(game, room, playerId, action) {
    const kind = action && action.kind;
    if (kind === 'lock') {
      game.applyLock(playerId, action);
      return { ended: game.finished };
    }
    throw new Error('알 수 없는 동작입니다.');
  },

  // 연결이 끊긴 플레이어는 봇 전환 대신 즉시 탈락 처리한다(rooms.js가 이 훅이 있으면 우선 사용).
  handleDisconnect(game, room, playerId) {
    game.eliminate(playerId);
    return { ended: game.finished };
  },

  serialize(game, room, viewerId) {
    const nameOf = (id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : '?';
    };
    // 이 뷰어에게 아직 전달하지 않은 가비지 공격을 실어보내고, 전달한 것으로 간주해 큐를 비운다.
    const myPending = game.pendingGarbage.get(viewerId) || [];
    const incomingGarbage = myPending.map((g) => ({ seq: g.seq, lines: g.lines, holeCol: g.holeCol, fromName: nameOf(g.fromId) }));
    myPending.length = 0;

    return {
      gameId: 'tetris',
      roomId: room.id,
      roomName: room.name,
      roundNo: room.roundNo,
      you: viewerId,
      seed: game.seed,
      finished: game.finished,
      winnerName: game.finished && game.winnerId ? nameOf(game.winnerId) : null,
      incomingGarbage,
      players: room.players.map((p) => {
        const b = game.boards.get(p.id) || {};
        return {
          id: p.id, name: p.name, connected: p.connected,
          alive: game.alive.has(p.id),
          topOut: !!b.topOut,
          linesCleared: b.linesCleared || 0,
          garbageSent: b.garbageSent || 0,
          garbageReceived: b.garbageReceived || 0,
          board: p.id === viewerId ? null : (b.lastBoard || null), // 내 보드는 로컬 엔진이 갖고 있으니 생략
          holdType: b.holdType || null,
          nextTypes: b.nextTypes || [],
          inVoice: !!p.inVoice, micMuted: !!p.micMuted,
        };
      }),
    };
  },

  seatLabel() { return ''; },

  settle(game, room) {
    const rows = game.results().map((r) => {
      const p = room.players.find((x) => x.id === r.id);
      return { ...r, name: p ? p.name : '?' };
    });
    room.matchOver = true;
    const winner = rows.find((r) => r.rank === 1);
    const payload = {
      gameId: 'tetris',
      roundNo: room.roundNo,
      rows,
      matchOver: true,
      winnerName: winner ? winner.name : '',
    };
    return { payload, continues: false };
  },
};
