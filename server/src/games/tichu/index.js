'use strict';
/**
 * 티츄 게임 엔진 (플러그인).
 * rooms.js(게임 독립 오케스트레이터)가 아래 인터페이스를 통해 게임을 구동한다.
 * 팀은 2:2 고정(A/B)이며, 매치는 여러 핸드(라운드)로 이뤄지고 팀 누적 점수는
 * room.teamScores 에 라운드 간 유지된다. targetScore에 도달하면 매치가 종료된다.
 */
const core = require('../../../../public/shared/tichu-core.js');
const { Game } = require('./game');
const { chooseBotAction, chooseBombInterrupt } = require('./bot');

const DEFAULT_TARGET = 1000;

function normalizeTargetScore(v) {
  const n = Math.round(Number(v) / 100) * 100;
  return Number.isFinite(n) && n >= 100 ? n : DEFAULT_TARGET;
}

module.exports = {
  meta: {
    id: 'tichu',
    name: '티츄',
    minPlayers: 4,
    maxPlayers: 4,
    settleDelay: 2600,
  },

  defaultOptions() {
    return { targetScore: DEFAULT_TARGET };
  },
  normalizeOptions(opts) {
    return { targetScore: normalizeTargetScore(opts && opts.targetScore) };
  },

  // 플레이어가 방에 들어오거나 옵션이 바뀔 때 호출됨. set_option이 매번 전원에 재호출하므로
  // team은 "미정의일 때만" 초기화해야 함(그렇지 않으면 목표점수 바꿀 때마다 팀 배정이 날아감).
  initPlayer(room, player) {
    if (player.team === undefined) player.team = null;
    if (!room.teamScores) room.teamScores = { A: 0, B: 0 };
  },
  // 새 매치 시작 시 팀 점수만 리셋(팀 배정은 유지)
  resetMatch(room) {
    room.teamScores = { A: 0, B: 0 };
  },

  // 정확히 4명, A팀 2명·B팀 2명이 아니면 시작 불가
  canStart(room) {
    if (room.players.length !== 4) return '정확히 4명이 필요합니다.';
    const a = room.players.filter((p) => p.team === 'A').length;
    const b = room.players.filter((p) => p.team === 'B').length;
    if (a !== 2 || b !== 2) return 'A팀 2명, B팀 2명이 되도록 배정해야 시작할 수 있습니다.';
    return null;
  },

  createGame(room) {
    if (!room.teamScores) room.teamScores = { A: 0, B: 0 };
    return new Game(room.players);
  },

  // 동시 결정 단계(그랜드 티츄/카드 나눔)에서는 "아직 미결정인 첫 사람"을 반환해
  // scheduleBotTurn이 봇을 자동 진행시키는 용도로만 쓰인다 — 사람은 순서 무관 언제든 액션 가능.
  currentActor(game) {
    if (game.finished) return null;
    if (game.pendingWish) return game.pendingWish;
    if (game.pendingDragonGive) return game.pendingDragonGive;
    if (game.phase === 'grand_declare') return game.playerIds.find((id) => game.grandPending.has(id)) || null;
    if (game.phase === 'exchange') return game.playerIds.find((id) => !game.exchangeSubmitted.has(id)) || null;
    return game.currentPlayerId();
  },

  botDelay() {
    return 700 + Math.random() * 900;
  },

  applyAction(game, room, playerId, action) {
    const kind = action && action.kind;
    if (kind === 'grand_tichu') { game.declareGrand(playerId, !!action.declare); return { ended: !!game.finished }; }
    if (kind === 'tichu') { game.declareTichu(playerId); return { ended: !!game.finished }; }
    if (kind === 'exchange') { game.submitExchange(playerId, action.gives || {}); return { ended: !!game.finished }; }
    if (kind === 'play') { game.play(playerId, action.cardIds || [], action.wish); return { ended: !!game.finished }; }
    if (kind === 'pass') { game.pass(playerId); return { ended: !!game.finished }; }
    if (kind === 'wish') { game.resolveWish(playerId, action.rank == null ? null : +action.rank); return { ended: !!game.finished }; }
    if (kind === 'give_dragon') { game.giveDragon(playerId, action.toPlayerId); return { ended: !!game.finished }; }
    throw new Error('알 수 없는 동작입니다.');
  },

  botAction(game, playerId) {
    return chooseBotAction(game, playerId);
  },

  // 자기 차례가 아닌 봇도 봄으로 끼어들 수 있는지 확인(있으면 {pid, action}, 없으면 null).
  // rooms.js가 매 액션 처리 뒤, 원래 차례인 사람의 턴을 진행시키기 전에 호출한다.
  checkBombInterrupt(game, room) {
    if (game.finished || game.phase !== 'trick' || !game.current) return null;
    const currentId = game.currentPlayerId();
    for (const pid of game.playerIds) {
      if (pid === currentId || game.finishOrder.includes(pid)) continue;
      const p = room.players.find((x) => x.id === pid);
      if (!p || !p.isBot) continue; // 사람 플레이어는 스스로 원할 때 직접 game_action을 보냄
      const action = chooseBombInterrupt(game, pid);
      if (action) return { pid, action };
    }
    return null;
  },

  serialize(game, room, viewerId) {
    const g = game;
    const nameOf = (id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : '?';
    };
    const myHandFull = g.hands.get(viewerId) || [];
    const hand = core.sortCards(g.phase === 'grand_declare' ? myHandFull.slice(0, 8) : myHandFull);

    const players = g.playerIds.map((pid) => {
      const p = room.players.find((x) => x.id === pid);
      return {
        id: pid,
        name: p ? p.name : '?',
        isBot: p ? p.isBot : false,
        connected: p ? p.connected : false,
        team: g.teamOf.get(pid),
        cardCount: g.hands.get(pid).length,
        grandTichu: g.grandTichu.has(pid) ? g.grandTichu.get(pid) : null,
        tichu: g.tichu.get(pid) === true,
        passed: g.passed.has(pid),
        out: g.finishOrder.includes(pid),
        finishRank: g.finishOrder.includes(pid) ? g.finishOrder.indexOf(pid) + 1 : null,
        inVoice: p ? !!p.inVoice : false,
        micMuted: p ? !!p.micMuted : false,
      };
    });

    return {
      gameId: 'tichu',
      roomId: room.id,
      roomName: room.name,
      roundNo: room.roundNo,
      you: viewerId,
      phase: g.phase,
      players,
      teamScores: room.teamScores,
      targetScore: room.options.targetScore,
      turnId: g.currentPlayerId(),
      leaderId: g.leaderId,
      table: g.current
        ? {
            cards: g.current.combo.cards,
            type: g.current.combo.type,
            length: g.current.combo.length,
            isBomb: g.current.combo.isBomb,
            rank: g.current.combo.rank,
            byId: g.current.byId,
            byName: nameOf(g.current.byId),
          }
        : null,
      trickPileCount: g.trickPile.length,
      wish: g.wish,
      pendingWish: g.pendingWish,
      pendingDragonGive: g.pendingDragonGive,
      dragonGiveOptions: g.pendingDragonGive === viewerId
        ? g.playerIds.filter((id) => id !== viewerId && g.teamOf.get(id) !== g.teamOf.get(viewerId))
        : null,
      grandPending: g.grandPending.has(viewerId),
      canDeclareTichu: g.phase !== 'grand_declare' && !g.hasPlayedCard.has(viewerId) &&
        g.grandTichu.get(viewerId) !== true && g.tichu.get(viewerId) !== true,
      exchangeSubmitted: g.exchangeSubmitted.has(viewerId),
      exchangeNeeded: g.phase === 'exchange' && !g.exchangeSubmitted.has(viewerId),
      hand,
      finishOrder: g.finishOrder,
      doubleWinTeam: g.doubleWinTeam,
      finished: g.finished,
      endReason: g.endReason,
    };
  },

  // 대기실 좌석 부가표시
  seatLabel(room, player) {
    if (!player.team) return '팀 미정';
    const score = (room.teamScores && room.teamScores[player.team]) || 0;
    return `${player.team}팀 · ${score}점`;
  },

  /**
   * 핸드 종료 정산. room.teamScores 갱신, matchOver 판정.
   * 반환: { payload(결과), continues(true=다음 핸드 대기, false=매치 종료) }
   */
  settle(game, room) {
    const g = game;
    const teamHand = { A: 0, B: 0 };

    if (g.endReason === 'doubleWin') {
      teamHand[g.doubleWinTeam] += 200;
    } else {
      const fourthId = g.playerIds.find((id) => !g.finishOrder.includes(id));
      const firstId = g.finishOrder[0];
      const fourthTeam = g.teamOf.get(fourthId);
      const otherTeam = fourthTeam === 'A' ? 'B' : 'A';
      // 4등의 남은 손패 점수는 상대팀에게
      teamHand[otherTeam] += core.handPoints(g.hands.get(fourthId));
      // 4등이 그동안 모아둔 트릭(3아웃 시점에 귀속된 몫 포함) 점수는 1등에게
      teamHand[g.teamOf.get(firstId)] += core.handPoints(g.collected.get(fourthId));
      // 1~3등은 각자 모은 트릭 점수를 자기 팀에 편입
      for (const pid of g.finishOrder) {
        teamHand[g.teamOf.get(pid)] += core.handPoints(g.collected.get(pid));
      }
    }

    const bonusRows = [];
    for (const pid of g.playerIds) {
      const team = g.teamOf.get(pid);
      const finishedFirst = g.finishOrder[0] === pid;
      if (g.grandTichu.get(pid) === true) {
        const delta = finishedFirst ? 200 : -200;
        teamHand[team] += delta;
        bonusRows.push({ id: pid, kind: 'grand', success: finishedFirst, delta });
      } else if (g.tichu.get(pid) === true) {
        const delta = finishedFirst ? 100 : -100;
        teamHand[team] += delta;
        bonusRows.push({ id: pid, kind: 'tichu', success: finishedFirst, delta });
      }
    }

    room.teamScores.A += teamHand.A;
    room.teamScores.B += teamHand.B;
    const target = room.options.targetScore;
    const matchOver = room.teamScores.A >= target || room.teamScores.B >= target;
    room.matchOver = matchOver;

    const rows = g.playerIds.map((pid) => {
      const p = room.players.find((x) => x.id === pid);
      return {
        id: pid,
        name: p.name,
        isBot: p.isBot,
        team: g.teamOf.get(pid),
        finishRank: g.finishOrder.includes(pid) ? g.finishOrder.indexOf(pid) + 1 : null,
        handPoints: core.handPoints(g.hands.get(pid)),
        collectedPoints: core.handPoints(g.collected.get(pid)),
        grandTichu: g.grandTichu.get(pid) === true,
        tichu: g.tichu.get(pid) === true,
      };
    });

    const payload = {
      gameId: 'tichu',
      roundNo: room.roundNo,
      endReason: g.endReason,
      doubleWinTeam: g.doubleWinTeam,
      teamHand,
      teamScores: { ...room.teamScores },
      targetScore: target,
      rows,
      bonusRows,
      matchOver,
      winningTeam: matchOver
        ? (room.teamScores.A > room.teamScores.B ? 'A' : room.teamScores.B > room.teamScores.A ? 'B' : null)
        : null,
    };
    return { payload, continues: !matchOver };
  },
};
