'use strict';
/**
 * 노땡스 게임 엔진 (플러그인).
 * rooms.js(게임 독립 오케스트레이터)가 아래 인터페이스를 통해 게임을 구동한다.
 * 노땡스는 덱 24장을 모두 소진하면 그대로 한 게임이 끝나므로(펠리시티와 동일한 방식),
 * 매치는 항상 한 게임으로 끝나고 다음 시작 시 새 게임으로 취급한다.
 */
const { Game } = require('./game');
const { chooseBotMove } = require('./bot');

module.exports = {
  meta: {
    id: 'notthanks',
    name: '노땡스',
    minPlayers: 3,
    maxPlayers: 5,
    settleDelay: 2000, // 덱 소진 후 마지막 카드를 잠시 보여준 뒤 정산
  },

  defaultOptions() { return {}; },
  normalizeOptions() { return {}; },
  initPlayer() {},  // 대기실 단계엔 게임별 경제가 없음(칩은 게임 인스턴스 안에서만 관리)
  resetMatch() {},

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
    if (kind === 'take') {
      const r = game.take(playerId);
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
    return { kind: mv.action };
  },

  serialize(game, room, viewerId) {
    const g = game;
    const nameOf = (id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : '?';
    };
    return {
      gameId: 'notthanks',
      roomId: room.id,
      roomName: room.name,
      roundNo: room.roundNo,
      you: viewerId,
      players: room.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, connected: p.connected,
        chips: g.chips.get(p.id) || 0,
        cards: g.cardsOwned.get(p.id) || [],
        inVoice: !!p.inVoice, micMuted: !!p.micMuted,
      })),
      turnId: g.finished ? null : g.currentPlayerId(),
      current: g.current,
      pot: g.pot,
      deckLeft: g.deck.length,
      seq: g.seq,
      lastAction: g.lastAction
        ? { type: g.lastAction.type, id: g.lastAction.playerId, name: nameOf(g.lastAction.playerId), pot: g.lastAction.pot, card: g.lastAction.card }
        : null,
      finished: g.finished,
    };
  },

  // 대기실 좌석 부가표시 — 게임 인스턴스 밖에서는 표시할 경제 정보가 없음
  seatLabel() {
    return '';
  },

  /**
   * 덱 소진 시 정산. 연속 숫자는 최저값만 합산, 보유 칩만큼 차감(낮을수록 좋음).
   * 노땡스는 한 게임이 곧 매치 전체이므로 항상 매치 종료로 처리한다.
   */
  settle(game, room) {
    const g = game;
    const res = g.results(); // [{id, cards, cardSum, chips, score}]
    const sorted = res.slice().sort((a, b) => a.score - b.score);
    const rankOf = new Map();
    sorted.forEach((r, i) => {
      const prev = i > 0 ? sorted[i - 1] : null;
      rankOf.set(r.id, prev && prev.score === r.score ? rankOf.get(prev.id) : i + 1);
    });

    const rows = res
      .map((r) => {
        const p = room.players.find((x) => x.id === r.id);
        return {
          id: r.id, name: p.name, isBot: p.isBot,
          rank: rankOf.get(r.id),
          cards: r.cards, cardSum: r.cardSum, chips: r.chips, score: r.score,
        };
      })
      .sort((a, b) => a.rank - b.rank);

    room.matchOver = true;

    const payload = {
      gameId: 'notthanks',
      roundNo: room.roundNo,
      rows,
      matchOver: true,
      winnerName: rows[0] ? rows[0].name : '',
    };
    return { payload, continues: false };
  },
};
