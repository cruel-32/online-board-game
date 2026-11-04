'use strict';
/**
 * 러너(점프 러너) 게임 엔진(플러그인) — Chrome Dino 느낌의 실시간 배틀로얄(최후 생존).
 * 테트리스(public/js/games/tetris, 클라이언트 권위 버전)와 완전히 같은 아키텍처를 쓴다:
 *
 * - "차례" 개념이 없다(currentActor는 항상 null). 사람 플레이어는 점프 키를 로컬 엔진에
 *   그 즉시 적용해 스스로 시뮬레이션하고(입력 반응 지연 없음 — Chrome Dino와 동일한 감각의
 *   핵심 전제), 장애물에 충돌해 죽었을 때 "버틴 시간" 한 번만 game_action으로 보고한다.
 *   서버는 매 프레임 물리를 재검증하지 않고 그 보고를 그대로 신뢰한다(자체 호스팅 캐주얼
 *   앱 규모에서는 충분히 안전하고, 틱 루프 없이도 동작해 서버 부하가 거의 없다).
 * - 봇만 예외로 서버가 직접 public/js/games/runner/engine.js 인스턴스를 들고 startBots()가
 *   시작하는 재귀 타이머로 진행시킨다(틱마다 bot.js의 반응시간 휴리스틱으로 점프 여부 결정).
 */
const { Game } = require('./game');
const Engine = require('../../../../public/js/games/runner/engine.js');
const Bot = require('./bot');
const { COUNTDOWN_MS } = require('../../../../public/shared/runner-core.js');

const BOT_TICK_MS = 40;

function scheduleBotTick(game, room, botId, engine, bot, hooks) {
  setTimeout(() => {
    if (room.game !== game || room.state !== 'playing' || game.finished || !game.alive.has(botId)) return;
    bot.step(engine);
    const ev = engine.tick(BOT_TICK_MS);
    if (ev.dead) {
      game.eliminate(botId, ev.elapsedMs);
      hooks.broadcast();
      if (game.finished) { hooks.finish(); return; }
    }
    scheduleBotTick(game, room, botId, engine, bot, hooks);
  }, BOT_TICK_MS);
}

module.exports = {
  meta: {
    id: 'runner',
    name: '러너',
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

  // rooms.js가 startGame() 직후 한 번 호출한다. 방에 있는 봇마다 서버 전용 엔진 인스턴스를
  // 만들어 틱 루프로 스스로 플레이를 시작시킨다(사람 클라이언트의 카운트다운과 맞춰 지연 시작).
  startBots(room, hooks) {
    const game = room.game;
    for (const p of room.players) {
      if (!p.isBot || game.botEngines.has(p.id)) continue;
      const engine = Engine.createEngine(game.seed);
      const bot = Bot.createBot();
      game.botEngines.set(p.id, engine);
      setTimeout(() => scheduleBotTick(game, room, p.id, engine, bot, hooks), COUNTDOWN_MS);
    }
  },

  // 차례 개념이 없는 실시간 게임 — 항상 null(= 턴제 봇 자동 진행 스케줄러가 개입하지 않음)
  currentActor() { return null; },
  botDelay() { return 99999; },
  botAction() { throw new Error('러너는 실시간 봇 루프(startBots)로 진행되어 턴제 botAction을 쓰지 않습니다.'); },

  applyAction(game, room, playerId, action) {
    const kind = action && action.kind;
    if (kind !== 'dead') throw new Error('알 수 없는 동작입니다.');
    if (game.alive.has(playerId) && !game.finished) {
      game.eliminate(playerId, action.elapsedMs);
    }
    return { ended: game.finished };
  },

  // 연결이 끊긴 플레이어는 즉시 탈락 처리한다(실시간 대전 중간에 이어받을 방법이 없음 — 테트리스와 동일 정책).
  handleDisconnect(game, room, playerId) {
    game.eliminate(playerId, Date.now() - game.startedAt - COUNTDOWN_MS);
    return { ended: game.finished };
  },

  serialize(game, room, viewerId) {
    return {
      gameId: 'runner',
      roomId: room.id,
      roomName: room.name,
      roundNo: room.roundNo,
      you: viewerId,
      seed: game.seed,
      finished: game.finished,
      winnerName: (() => {
        if (!game.finished || !game.winnerId) return null;
        const p = room.players.find((x) => x.id === game.winnerId);
        return p ? p.name : null;
      })(),
      players: room.players.map((p) => ({
        id: p.id, name: p.name, connected: p.connected,
        alive: game.alive.has(p.id),
        survivedMs: game.survivedMs.get(p.id) || 0,
        inVoice: !!p.inVoice, micMuted: !!p.micMuted,
      })),
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
      gameId: 'runner',
      roundNo: room.roundNo,
      rows,
      matchOver: true,
      winnerName: winner ? winner.name : '',
    };
    return { payload, continues: false };
  },
};
