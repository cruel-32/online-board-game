'use strict';
/**
 * 우노(UNO) 게임 엔진 (플러그인). 한 판(한 손패)을 끝까지 진행하고 정산한다.
 * 코인/칩 경제 없이 매 판이 곧 최종(matchOver=true) — 결과 팝업의 "다시 하기"로 새 판.
 */
const { UnoGame, cardPoints } = require('./game');
const { chooseBotMove } = require('./bot');

module.exports = {
  meta: {
    id: 'uno',
    name: '우노',
    minPlayers: 2,
    maxPlayers: 6,
    settleDelay: 2500, // 승리 상태를 잠시 보여준 뒤 정산
  },

  defaultOptions() { return {}; },
  normalizeOptions() { return {}; },
  initPlayer() {},
  resetMatch() {},

  createGame(room) { return new UnoGame(room.players); },

  currentActor(game) { return game.currentActorId(); },

  botDelay() { return 800 + Math.random() * 700; },

  applyAction(game, room, playerId, action) {
    const kind = action && action.kind;
    if (kind === 'play') return game.play(playerId, action.cardId, action.color);
    if (kind === 'draw') return game.draw(playerId);
    if (kind === 'pass') return game.pass(playerId);
    throw new Error('알 수 없는 동작입니다.');
  },

  botAction(game, playerId) { return chooseBotMove(game, playerId); },

  serialize(game, room, viewerId) {
    const nameOf = (id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : '?';
    };
    const players = room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      connected: p.connected,
      handCount: game.handOf(p.id).length,
      inVoice: !!p.inVoice, micMuted: !!p.micMuted,
    }));

    const justDrewMine = game.justDrew && game.justDrew.pid === viewerId ? game.justDrew.cardId : null;

    return {
      gameId: 'uno',
      roomId: room.id,
      roomName: room.name,
      you: viewerId,
      players,
      turnId: game.currentActorId(),
      dir: game.dir,
      currentColor: game.currentColor,
      discardTop: game.top(),
      drawCount: game.deck.length,
      hand: game.handOf(viewerId) || [],
      justDrewCardId: justDrewMine,          // 방금 뽑은(낼지 선택할) 카드
      penalty: game.penalty,                 // { byId, targetId, count, seq } — 드로우 페널티 애니메이션용
      lastAction: game.lastAction ? { name: nameOf(game.lastAction.pid), text: game.lastAction.text } : null,
      finished: game.finished,
      winnerId: game.winnerId,
      winnerName: game.winnerId ? nameOf(game.winnerId) : null,
    };
  },

  seatLabel() { return ''; },

  settle(game, room) {
    const nameOf = (id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : '?';
    };
    const res = game.results();
    // 승자(손패 0, points 0)가 1등. 나머지는 남은 점수 오름차순.
    const rows = res.map((r) => ({
      id: r.id, name: nameOf(r.id), isBot: (room.players.find((p) => p.id === r.id) || {}).isBot,
      remaining: r.remaining, points: r.points,
    }));
    rows.sort((a, b) => a.points - b.points || a.remaining - b.remaining);
    rows.forEach((row, i) => {
      const prev = i > 0 ? rows[i - 1] : null;
      row.rank = prev && prev.points === row.points && prev.remaining === row.remaining ? prev.rank : i + 1;
    });

    room.matchOver = true;
    const winnerName = game.winnerId ? nameOf(game.winnerId) : (rows[0] && rows[0].name);
    const payload = { gameId: 'uno', winnerName, rows };
    return { payload, continues: false };
  },
};
