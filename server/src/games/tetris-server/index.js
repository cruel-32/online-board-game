'use strict';
/**
 * 테트리스(서버권위) 게임 엔진(플러그인) — public/js/games/tetris(클라이언트 권위 버전)와
 * 완전히 동일한 배틀로얄 규칙(가비지 공격, 최후 생존)을 서버가 물리까지 전부 계산하는 방식으로
 * 재구현한 비교용 쌍둥이 게임이다.
 *
 * 아키텍처 차이:
 * - 클라이언트는 로컬 시뮬레이션을 전혀 하지 않는다. 키 입력을 그대로 game_action으로 보내고,
 *   서버가 그 즉시 자신의 엔진 인스턴스에 적용한 뒤 결과를 브로드캐스트하면 그걸 그대로 그린다.
 * - 서버는 방에 있는 전원(사람+봇)의 TetrisEngine 인스턴스를 직접 들고, startRealtime()이 시작하는
 *   방 전체 tick 루프가 주기적으로 중력/락딜레이를 진행시킨다(사람이 아무 입력을 안 해도 자연히
 *   낙하해야 하므로, 클라이언트 권위 버전과 달리 서버가 "시간의 흐름" 자체를 책임져야 한다).
 * - 봇은 기존 tetris/bot.js의 배치 탐색 로직을 그대로 재사용한다(엔진이 같으므로 재구현 불필요).
 */
const { Game } = require('./game');
const Bot = require('../tetris/bot');

const TICK_MS = 50; // 서버가 전원의 중력/락딜레이를 진행시키고 상태를 브로드캐스트하는 주기(20Hz)
const BOT_START_DELAY_MS = 3400; // 클라이언트의 3·2·1·GO 카운트다운과 맞춰 봇도 그만큼 대기 후 시작
const BOT_MOVE_INTERVAL_MS = 700; // 봇 한 수(조각 하나)당 걸리는 "생각+낙하" 시간

function flattenBoard(board2d) {
  const flat = [];
  for (const row of board2d) for (const cell of row) flat.push(cell);
  return flat;
}

function handleLock(game, pid, ev) {
  if (ev && ev.locked) game.applyLockResult(pid, ev);
}

// 방 전체 실시간 루프: 살아있는 전원의 엔진에 중력/락딜레이를 진행시키고 매 틱 상태를 브로드캐스트한다.
// 사람의 입력(이동/회전/하드드롭)은 game_action이 즉시 반영하므로, 이 루프는 오직
// "시간이 흘러 자연히 낙하/고정되는 것"만 담당한다. room.game이 바뀌거나 끝나면 스스로 멈춘다.
function scheduleTick(game, room, hooks) {
  setTimeout(() => {
    if (room.game !== game || room.state !== 'playing' || game.finished) return;
    for (const pid of [...game.alive]) {
      const engine = game.engines.get(pid);
      const ev = engine.tick(TICK_MS);
      handleLock(game, pid, ev);
      if (game.finished) break;
    }
    if (game.finished) { hooks.finish(); return; }
    hooks.broadcast();
    scheduleTick(game, room, hooks);
  }, TICK_MS);
}

// 봇 하나를 계속 진행시키는 재귀 타이머(클라이언트 권위 버전의 동일 패턴 재사용).
function scheduleBotMove(game, room, botId, engine, hooks, delayMs) {
  setTimeout(() => {
    if (room.game !== game || room.state !== 'playing' || game.finished || !game.alive.has(botId)) return;
    const ev = Bot.playOneMove(engine);
    handleLock(game, botId, ev);
    if (game.finished) { hooks.finish(); return; }
    scheduleBotMove(game, room, botId, engine, hooks, BOT_MOVE_INTERVAL_MS);
  }, delayMs);
}

module.exports = {
  meta: {
    id: 'tetris-server',
    name: '테트리스', // 사용자에게는 그냥 "테트리스"로 노출(기존 클라이언트 권위 버전은 registry.js에서 목록 제외)
    minPlayers: 2,
    maxPlayers: 4,
    settleDelay: 2500,
  },

  defaultOptions() { return {}; },
  normalizeOptions() { return {}; },
  initPlayer() {},
  resetMatch() {},

  createGame(room) {
    return new Game(room.players);
  },

  // 턴 개념이 없는 실시간 게임 — scheduleBotTurn(턴제 봇 스케줄러)이 개입하지 않도록 항상 null.
  currentActor() { return null; },
  botDelay() { return 99999; },
  botAction() { throw new Error('이 게임은 실시간 봇 루프(startRealtime)로 진행되어 턴제 botAction을 쓰지 않습니다.'); },

  // rooms.js가 startGame() 직후 한 번 호출한다. 방 전체 중력 루프 + 봇별 결정 루프를 시작시킨다.
  startRealtime(room, hooks) {
    const game = room.game;
    scheduleTick(game, room, hooks);
    for (const p of room.players) {
      if (!p.isBot) continue;
      const engine = game.engines.get(p.id);
      scheduleBotMove(game, room, p.id, engine, hooks, BOT_START_DELAY_MS);
    }
  },

  // 사람 플레이어의 입력을 그 즉시 서버 쪽 엔진 인스턴스에 적용한다(로컬 시뮬레이션 없음).
  applyAction(game, room, playerId, action) {
    const kind = action && action.kind;
    const engine = game.engines.get(playerId);
    if (!engine) throw new Error('플레이어를 찾을 수 없습니다.');
    if (!game.alive.has(playerId) || game.finished) return { ended: game.finished };

    let ev = null;
    switch (kind) {
      case 'moveLeft': engine.moveLeft(); break;
      case 'moveRight': engine.moveRight(); break;
      case 'softDrop': engine.softDrop(); break;
      case 'rotateCW': engine.rotateCW(); break;
      case 'rotateCCW': engine.rotateCCW(); break;
      case 'hold': engine.hold(); break;
      case 'hardDrop': ev = engine.hardDrop(); break;
      default: throw new Error('알 수 없는 동작입니다.');
    }
    handleLock(game, playerId, ev);
    return { ended: game.finished };
  },

  // 연결이 끊긴 플레이어는 봇 전환 대신 즉시 탈락 처리(클라이언트 권위 버전과 동일 정책).
  handleDisconnect(game, room, playerId) {
    game.eliminate(playerId);
    return { ended: game.finished };
  },

  serialize(game, room, viewerId) {
    const nameOf = (id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : '?';
    };
    // 이 뷰어에게 아직 알리지 않은 연출용 알림(공격 받음/내가 낸 락 결과)을 실어보내고 큐를 비운다.
    // 판정 자체(가비지 반영)는 이미 즉시 처리되어 있으므로, 이 알림이 늦거나 유실돼도 게임 결과엔 영향 없다.
    const myAttacks = game.pendingAttacks.get(viewerId) || [];
    const incomingAttacks = myAttacks.map((a) => ({ lines: a.lines, fromName: nameOf(a.fromId) }));
    myAttacks.length = 0;
    const myEvents = game.selfEvents.get(viewerId) || [];
    const selfEvents = myEvents.slice();
    myEvents.length = 0;

    return {
      gameId: 'tetris-server',
      roomId: room.id,
      roomName: room.name,
      roundNo: room.roundNo,
      you: viewerId,
      finished: game.finished,
      winnerName: game.finished && game.winnerId ? nameOf(game.winnerId) : null,
      incomingAttacks,
      selfEvents,
      // 서버가 모든 진실을 갖고 있으므로(클라이언트 권위 버전과 달리) 내 보드도 여기 그대로 포함한다.
      players: room.players.map((p) => {
        const engine = game.engines.get(p.id);
        const st = engine ? engine.getState() : null;
        const s = game.stats.get(p.id) || {};
        return {
          id: p.id, name: p.name, connected: p.connected,
          alive: game.alive.has(p.id),
          linesCleared: s.linesCleared || 0,
          garbageSent: s.garbageSent || 0,
          garbageReceived: s.garbageReceived || 0,
          board: st ? flattenBoard(st.board) : null,
          cur: st && st.cur ? { type: st.cur.type, rot: st.cur.rot, x: st.cur.x, y: st.cur.y } : null,
          ghostY: st && st.cur ? engine.ghostY() : null,
          holdType: st ? st.hold : null,
          nextTypes: st ? st.queue.slice(0, 5) : [],
          incomingGarbageCount: st ? st.incomingGarbage.reduce((sum, g) => sum + g.lines, 0) : 0,
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
      gameId: 'tetris-server',
      roundNo: room.roundNo,
      rows,
      matchOver: true,
      winnerName: winner ? winner.name : '',
    };
    return { payload, continues: false };
  },
};
