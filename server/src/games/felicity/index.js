'use strict';
/**
 * 펠리시티(자루 속 고양이) 게임 엔진 (플러그인).
 * 4~5인 기본 룰. 코인은 비공개(serialize에서 본인 것만 실제 값 노출).
 */
const core = require('../../../../public/shared/felicity-core.js');
const { FelicityGame } = require('./game');
const { chooseBotMove } = require('./bot');

module.exports = {
  meta: {
    id: 'felicity',
    name: '펠리시티',
    minPlayers: 4,
    maxPlayers: 5,
    settleDelay: 0,
  },

  defaultOptions() { return {}; },
  normalizeOptions() { return {}; },
  initPlayer() {},   // 대기실 단계엔 게임별 경제가 없음(코인은 게임 인스턴스 안)
  resetMatch() {},

  createGame(room) {
    return new FelicityGame(room.players);
  },

  currentActor(game) {
    return game.currentActorId();
  },

  botDelay() {
    return 800 + Math.random() * 700;
  },

  applyAction(game, room, playerId, action) {
    const kind = action && action.kind;
    if (kind === 'place') return game.place(playerId, action.cardId);
    if (kind === 'bid') return game.bid(playerId, action.amount);
    if (kind === 'pass') return game.pass(playerId);
    throw new Error('알 수 없는 동작입니다.');
  },

  botAction(game, playerId) {
    return chooseBotMove(game, playerId);
  },

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
      color: game.colors[p.id],
      colorLabel: core.COLOR_LABEL[game.colors[p.id]],
      handCount: game.hands.get(p.id).length,
      coins: p.id === viewerId ? game.coins.get(p.id) : null, // 코인 비공개
      bid: game.bids.get(p.id) || 0,
      passed: game.passed.has(p.id),
      collectedCount: game.collected.get(p.id).length,
      isStart: game.playerIds[game.startIdx] === p.id,
      inVoice: !!p.inVoice, micMuted: !!p.micMuted,
    }));

    const lr = game.lastResult;
    const lastResult = lr ? {
      winnerId: lr.winnerId,
      winnerName: lr.winnerId ? nameOf(lr.winnerId) : null,
      bid: lr.bid,
      kept: lr.kept,
      removed: lr.removed,
      discarded: lr.discarded,
    } : null;

    let scores = null;
    if (game.finished) {
      scores = game.results().map((r) => ({ id: r.id, name: nameOf(r.id), cardPts: r.cardPts, coins: r.coins, total: r.total, collected: r.collected }));
      scores.sort((a, b) => (b.total - a.total) || (b.cardPts - a.cardPts));
      scores.forEach((s, i) => {
        const prev = i > 0 ? scores[i - 1] : null;
        s.rank = prev && prev.total === s.total && prev.cardPts === s.cardPts ? prev.rank : i + 1;
      });
    }

    return {
      gameId: 'felicity',
      roomId: room.id,
      roomName: room.name,
      round: game.round,
      totalRounds: core.ROUNDS,
      phase: game.phase,
      you: viewerId,
      players,
      startId: game.playerIds[game.startIdx],
      turnId: game.currentActorId(),
      mouse: game.mouseNums.map((num, i) => ({ num, coins: game.mouseCoins[i] })),
      bank: game.bank,
      highBid: game.highBid,
      highBidId: game.highBidder,
      row: game.row.map((s) => ({ ownerId: s.ownerId, faceUp: s.faceUp, card: s.faceUp ? s.card : null })),
      hand: game.hands.get(viewerId) || [],
      yourColor: game.colors[viewerId],
      lastResult,
      finished: game.finished,
      scores,
    };
  },

  seatLabel() { return ''; },

  settle(game, room) {
    const nameOf = (id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : '?';
    };
    const scores = game.results().map((r) => ({
      id: r.id, name: nameOf(r.id), isBot: (room.players.find((p) => p.id === r.id) || {}).isBot,
      cardPts: r.cardPts, coins: r.coins, total: r.total,
    }));
    scores.sort((a, b) => (b.total - a.total) || (b.cardPts - a.cardPts));
    scores.forEach((s, i) => {
      const prev = i > 0 ? scores[i - 1] : null;
      s.rank = prev && prev.total === s.total && prev.cardPts === s.cardPts ? prev.rank : i + 1;
    });
    room.matchOver = true; // 매 게임 종료가 곧 최종. 다음 시작 시 새 게임.
    const payload = { gameId: 'felicity', gameOver: true, scores };
    return { payload, continues: false };
  },
};
