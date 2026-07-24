'use strict';
/**
 * 세븐 포커(7-card stud) 게임 엔진 (플러그인). 멀티핸드 매치 — 칩은 room.players[].chips 유지.
 */
const { SevenGame } = require('./game');
const { chooseBotMove } = require('./bot');
const poker = require('../../../../public/shared/poker-core.js');

const DEFAULT_STACK = 1000;
const ANTE = 10, UNIT = 20;

function normalizeStack(v) {
  const n = Math.round(Number(v) / 100) * 100;
  return Number.isFinite(n) && n >= 500 ? n : DEFAULT_STACK;
}

module.exports = {
  meta: { id: 'seven', name: '세븐포커', minPlayers: 2, maxPlayers: 6, settleDelay: 3000 },

  defaultOptions() { return { stack: DEFAULT_STACK }; },
  normalizeOptions(opts) { return { stack: normalizeStack(opts && opts.stack) }; },
  initPlayer(room, player) { player.chips = room.options.stack; },
  resetMatch(room) { for (const p of room.players) p.chips = room.options.stack; },

  createGame(room) {
    const seated = room.players.filter((p) => p.chips > 0);
    return new SevenGame(seated, { ante: ANTE, unit: UNIT });
  },

  currentActor(game) { return game.currentActorId(); },
  botDelay() { return 900 + Math.random() * 800; },
  applyAction(game, room, playerId, action) { return game.act(playerId, action || {}); },
  botAction(game, playerId) { return chooseBotMove(game, playerId); },

  serialize(game, room, viewerId) {
    const nameOf = (id) => { const p = room.players.find((x) => x.id === id); return p ? p.name : '?'; };
    const turnId = game.currentActorId();
    const revealSet = new Set(game.showdownIds || []);
    const streetLabel = { 3: '3rd', 4: '4th', 5: '5th', 6: '6th', 7: '7th' }[game.streetNo] + ' 스트리트';

    const serCards = (seat, isViewer) => seat.cards.map((c) => {
      if (c.up || isViewer || revealSet.has(seat.id)) return { rank: c.card.rank, suit: c.card.suit, up: c.up };
      return { up: false, hidden: true };
    });

    const players = room.players.map((p) => {
      const s = game.seatById(p.id);
      if (!s) return { id: p.id, name: p.name, isBot: p.isBot, connected: p.connected, out: true, stack: p.chips || 0, cards: [], inVoice: !!p.inVoice, micMuted: !!p.micMuted };
      return {
        id: p.id, name: p.name, isBot: p.isBot, connected: p.connected,
        stack: s.stack, committed: s.committed, folded: s.folded, allIn: s.allIn, won: s.won,
        cards: serCards(s, p.id === viewerId),
        inVoice: !!p.inVoice, micMuted: !!p.micMuted,
      };
    });

    const me = game.seatById(viewerId);
    const winners = game.finished && game.winners ? game.winners.map((w) => ({ id: w.id, name: nameOf(w.id), amount: w.amount })) : null;

    return {
      gameId: 'seven',
      roomId: room.id, roomName: room.name, roundNo: room.roundNo,
      you: viewerId, players,
      pot: game.potTotal(), street: streetLabel, betToMatch: game.betToMatch,
      turnId,
      options: turnId === viewerId ? game.options(viewerId) : null,
      hand: me ? me.cards.map((c) => ({ rank: c.card.rank, suit: c.card.suit, up: c.up })) : [],
      lastAction: game.lastAction ? { name: nameOf(game.lastAction.id), text: game.lastAction.text } : null,
      finished: game.finished, winners, showdown: !!game.showdownIds,
    };
  },

  seatLabel(room, player) { return `● ${player.chips}칩`; },

  settle(game, room) {
    const nameOf = (id) => { const p = room.players.find((x) => x.id === id); return p ? p.name : '?'; };
    for (const s of game.seats) { const p = room.players.find((x) => x.id === s.id); if (p) p.chips = s.stack; }
    const alive = room.players.filter((p) => p.chips > 0);
    const matchOver = alive.length <= 1;
    room.matchOver = matchOver;

    const revealSet = new Set(game.showdownIds || []);
    const rows = game.seats.map((s) => {
      const reveal = revealSet.has(s.id);
      const best = reveal ? poker.evaluateBest(s.cards.map((c) => c.card)) : null;
      return {
        id: s.id, name: nameOf(s.id), isBot: (room.players.find((p) => p.id === s.id) || {}).isBot,
        stack: s.stack, won: s.won, folded: s.folded, hand: best ? best.name : null,
      };
    });
    const winners = (game.winners || []).map((w) => ({ name: nameOf(w.id), amount: w.amount }));
    const payload = { gameId: 'seven', winners, rows, matchOver, championName: matchOver && alive[0] ? alive[0].name : null };
    return { payload, continues: !matchOver };
  },
};
