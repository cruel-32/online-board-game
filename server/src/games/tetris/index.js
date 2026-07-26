'use strict';
/**
 * 테트리스 게임 엔진(플러그인) — 배틀로얄(가비지 공격, 최후 생존).
 * rooms.js(게임 독립 오케스트레이터)가 이 인터페이스를 통해 게임을 구동한다.
 *
 * 다른 게임들과 달리 "차례" 개념이 없다: currentActor는 항상 null을 반환해
 * rooms.js의 턴제 봇 자동 진행 스케줄러(scheduleBotTurn)가 자연히 아무 일도 하지 않게 한다.
 * 실제 진행(중력·충돌·회전)은 각 클라이언트가 로컬에서 시뮬레이션하고, 조각이 고정될 때마다
 * game_action으로 결과만 보고한다 — 그래서 이 엔진은 서버 쪽 tick(주기적 갱신)이 필요 없다.
 *
 * 테트리스 봇은 턴제 게임 봇과 완전히 별도 경로로 동작한다: startGame() 직후 rooms.js가
 * 호출하는 startBots()가 봇마다 클라이언트와 동일한 public/js/games/tetris/engine.js
 * 인스턴스를 서버에서 직접 돌리고(엔진 재구현 없음), bot.js의 휴리스틱으로 스스로 플레이하며,
 * 사람 클라이언트와 동일하게 game.applyLock()으로 결과를 보고한다.
 * 연결이 끊긴(봇이 아닌) 플레이어는 봇으로 전환하는 다른 게임들과 달리 handleDisconnect로
 * 즉시 탈락 처리한다(실시간 대전 중간에 봇이 대신 이어받기엔 상태 이관이 마땅치 않음).
 */
const { Game } = require('./game');
const Engine = require('../../../../public/js/games/tetris/engine.js');
const Bot = require('./bot');

const BOT_START_DELAY_MS = 3400; // 클라이언트의 3·2·1·GO 카운트다운과 맞춰 봇도 그만큼 대기 후 시작
const BOT_MOVE_INTERVAL_MS = 700; // 봇 한 수(조각 하나)당 걸리는 "생각+낙하" 시간

function flattenBoard(board2d) {
  const flat = [];
  for (const row of board2d) for (const cell of row) flat.push(cell);
  return flat;
}

// 봇 하나를 계속 진행시키는 재귀 타이머. room.game이 바뀌거나 게임이 끝나면 스스로 멈춘다.
// delayMs를 인자로 받아, 첫 수만 카운트다운만큼 더 기다리고 이후엔 일반 간격으로 반복한다.
function scheduleBotMove(game, room, botId, engine, hooks, delayMs) {
  setTimeout(() => {
    if (room.game !== game || room.state !== 'playing' || game.finished || !game.alive.has(botId)) return;

    // 서버가 아직 이 봇에게 전달하지 않은 가비지 공격을 로컬 엔진에 반영
    // (사람 클라이언트의 setState가 매 프레임 하는 일과 동일).
    const pending = game.pendingGarbage.get(botId) || [];
    for (const g of pending) engine.queueGarbage(g.lines, g.holeCol);
    pending.length = 0;

    const st = engine.getState();
    const ev = Bot.playOneMove(engine);
    if (ev.locked) {
      game.applyLock(botId, {
        linesCleared: ev.linesCleared,
        garbageSent: ev.garbageSent,
        topOut: ev.topOut,
        board: flattenBoard(st.board),
        holdType: st.hold,
        nextTypes: st.queue.slice(0, 5),
      });
    }

    if (game.finished) { hooks.finish(); return; }
    hooks.broadcast();
    scheduleBotMove(game, room, botId, engine, hooks, BOT_MOVE_INTERVAL_MS);
  }, delayMs);
}

module.exports = {
  meta: {
    id: 'tetris',
    name: '테트리스',
    minPlayers: 2,
    maxPlayers: 4,
    settleDelay: 2500,
  },

  defaultOptions() { return {}; },
  normalizeOptions() { return {}; },
  initPlayer() {},  // 대기실 단계엔 게임별 경제가 없음
  resetMatch() {},

  createGame(room) {
    return new Game(room.players);
  },

  // rooms.js가 startGame() 직후 한 번 호출한다. 방에 있는 봇마다 서버 전용 엔진 인스턴스를
  // 만들어 game.botEngines에 등록하고, 각자 독립된 타이머로 스스로 플레이를 시작시킨다.
  startBots(room, hooks) {
    const game = room.game;
    for (const p of room.players) {
      if (!p.isBot || game.botEngines.has(p.id)) continue;
      const engine = Engine.createEngine(game.seed);
      game.botEngines.set(p.id, engine);
      // 첫 수는 사람 클라이언트의 3·2·1·GO 카운트다운이 끝난 뒤에 두도록 그만큼 더 지연.
      scheduleBotMove(game, room, p.id, engine, hooks, BOT_START_DELAY_MS);
    }
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
