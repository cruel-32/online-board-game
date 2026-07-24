'use strict';
/**
 * 텍사스 홀덤 게임 엔진 (플러그인). 멀티핸드 매치 — 칩은 room.players[].chips 에 유지되고,
 * 한 명만 칩이 남으면 매치 종료(matchOver). 매 핸드가 하나의 "라운드".
 */
const { HoldemGame } = require('./game');
const { chooseBotMove } = require('./bot');
const poker = require('../../../../public/shared/poker-core.js');

const DEFAULT_STACK = 1000;
const SB = 10, BB = 20;

function normalizeStack(v) {
  const n = Math.round(Number(v) / 100) * 100;
  return Number.isFinite(n) && n >= 500 ? n : DEFAULT_STACK;
}

module.exports = {
  meta: { id: 'holdem', name: '홀덤', minPlayers: 2, maxPlayers: 6, settleDelay: 3000 },

  defaultOptions() { return { stack: DEFAULT_STACK }; },
  normalizeOptions(opts) { return { stack: normalizeStack(opts && opts.stack) }; },
  initPlayer(room, player) { player.chips = room.options.stack; },
  resetMatch(room) { for (const p of room.players) p.chips = room.options.stack; },

  createGame(room) {
    const seated = room.players.filter((p) => p.chips > 0);
    const dealerIdx = ((room.roundNo || 1) - 1) % seated.length;
    return new HoldemGame(seated, { smallBlind: SB, bigBlind: BB, dealerIdx });
  },

  currentActor(game) { return game.currentActorId(); },
  botDelay() { return 900 + Math.random() * 800; },

  applyAction(game, room, playerId, action) {
    return game.act(playerId, action || {});
  },

  botAction(game, playerId) { return chooseBotMove(game, playerId); },

  serialize(game, room, viewerId) {
    const nameOf = (id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : '?';
    };
    const idAt = (idx) => (game.seats[idx] ? game.seats[idx].id : null);
    const dealerId = idAt(game.dealerIdx), sbId = idAt(game.sbIdx), bbId = idAt(game.bbIdx);
    const turnId = game.currentActorId();
    const revealSet = new Set(game.showdownIds || []);

    const players = room.players.map((p) => {
      const s = game.seatById(p.id);
      if (!s) return { id: p.id, name: p.name, isBot: p.isBot, connected: p.connected, out: true, stack: p.chips || 0, inVoice: !!p.inVoice, micMuted: !!p.micMuted };
      const showHole = p.id === viewerId || revealSet.has(p.id);
      return {
        id: p.id, name: p.name, isBot: p.isBot, connected: p.connected,
        stack: s.stack, committed: s.committed, totalCommitted: s.totalCommitted,
        folded: s.folded, allIn: s.allIn, won: s.won,
        isDealer: p.id === dealerId, isSB: p.id === sbId, isBB: p.id === bbId,
        hole: showHole ? s.hole : null,
        inVoice: !!p.inVoice, micMuted: !!p.micMuted,
      };
    });

    const winners = game.finished && game.winners
      ? game.winners.map((w) => ({ id: w.id, name: nameOf(w.id), amount: w.amount }))
      : null;

    return {
      gameId: 'holdem',
      roomId: room.id, roomName: room.name, roundNo: room.roundNo,
      you: viewerId,
      players,
      board: game.board,
      pot: game.potTotal(),
      street: game.street,
      betToMatch: game.betToMatch,
      turnId,
      dealerId, sbId, bbId,
      options: turnId === viewerId ? game.options(viewerId) : null,
      hand: (game.seatById(viewerId) && game.seatById(viewerId).hole) || [],
      lastAction: game.lastAction ? { name: nameOf(game.lastAction.id), text: game.lastAction.text } : null,
      finished: game.finished,
      winners,
      showdown: !!game.showdownIds,
    };
  },

  seatLabel(room, player) { return `● ${player.chips}칩`; },

  settle(game, room) {
    const nameOf = (id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : '?';
    };
    // 스택 반영
    for (const s of game.seats) {
      const p = room.players.find((x) => x.id === s.id);
      if (p) p.chips = s.stack;
    }
    const alive = room.players.filter((p) => p.chips > 0);
    const matchOver = alive.length <= 1;
    room.matchOver = matchOver;

    const revealSet = new Set(game.showdownIds || []);
    const rows = game.seats.map((s) => {
      const reveal = revealSet.has(s.id) && game.board.length >= 5;
      const best = reveal ? poker.evaluateBest([...s.hole, ...game.board]) : null;
      return {
        id: s.id, name: nameOf(s.id), isBot: (room.players.find((p) => p.id === s.id) || {}).isBot,
        stack: s.stack, won: s.won, folded: s.folded,
        hand: best ? best.name : null,
      };
    });
    const winners = (game.winners || []).map((w) => ({ name: nameOf(w.id), amount: w.amount }));

    const payload = {
      gameId: 'holdem',
      board: game.board,
      winners,
      rows,
      matchOver,
      championName: matchOver && alive[0] ? alive[0].name : null,
    };
    return { payload, continues: !matchOver };
  },
};
