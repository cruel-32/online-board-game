'use strict';
const core = require('../../../../public/shared/tichu-core.js');

function handStrengthScore(cards) {
  let s = 0;
  for (const c of cards) {
    if (c.special === 'dragon') s += 3;
    else if (c.special === 'phoenix') s += 2;
    else if (c.special === 'mahjong') s += 1;
    else if (c.rank === 14) s += 2;
    else if (c.rank === 13) s += 1.5;
    else if (c.rank >= 11) s += 1;
  }
  const byRank = new Map();
  for (const c of cards) if (!c.special) byRank.set(c.rank, (byRank.get(c.rank) || 0) + 1);
  for (const cnt of byRank.values()) if (cnt >= 3) s += 2;
  return s;
}

function chooseGrandTichu(game, pid) {
  const eight = game.hands.get(pid).slice(0, 8);
  const declare = handStrengthScore(eight) >= 7 && Math.random() < 0.5; // 실제로도 드문 이벤트
  return { kind: 'grand_tichu', declare };
}

function chooseExchange(game, pid) {
  const hand = game.hands.get(pid);
  // 드래곤/불사조/마작은 절대 넘기지 않고, 나머지 중 가장 약한 3장(개 포함 가능)을 넘긴다.
  const giveable = hand.filter((c) => c.special !== 'dragon' && c.special !== 'phoenix' && c.special !== 'mahjong');
  const chosen = giveable.slice().sort((a, b) => (a.rank || 0) - (b.rank || 0)).slice(0, 3);
  return { kind: 'exchange', gives: { left: chosen[0].id, right: chosen[1].id, partner: chosen[2].id } };
}

function chooseWish(game, pid) {
  if (Math.random() < 0.35) return { kind: 'wish', rank: null };
  return { kind: 'wish', rank: 11 + Math.floor(Math.random() * 4) }; // J~A 중 하나
}

function chooseDragonGive(game, pid) {
  const opponents = game.playerIds.filter((id) => id !== pid && game.teamOf.get(id) !== game.teamOf.get(pid));
  const target = opponents.reduce(
    (best, id) => (game.hands.get(id).length > game.hands.get(best).length ? id : best),
    opponents[0]
  );
  return { kind: 'give_dragon', toPlayerId: target };
}

function choosePlayOrPass(game, pid) {
  const hand = game.hands.get(pid);
  const current = game.current ? game.current.combo : null;
  const allPlays = core.validPlays(hand, current);

  // 소원이 걸려 있고 그걸 만족하는 패가 있으면 반드시 그중에서 내야 함(패스/다른 패 금지) —
  // 아래의 "파트너에게 양보" "봄 아끼기" 휴리스틱보다 항상 우선한다.
  let plays = allPlays;
  let wishForced = false;
  if (game.wish != null) {
    const fulfilling = allPlays.filter((p) => p.cards.some((c) => c.rank === game.wish && !c.special));
    if (fulfilling.length) { plays = fulfilling; wishForced = true; }
  }
  if (!plays.length) return { kind: 'pass' };

  // 파트너가 이미 이기고 있는 트릭이면 웬만하면 양보(협동 휴리스틱)
  const partnerId = game.partnerOf(pid);
  if (!wishForced && game.current && game.current.byId === partnerId && Math.random() < 0.75) {
    return { kind: 'pass' };
  }

  const othersMin = Math.min(
    ...game.playerIds.filter((id) => id !== pid && !game.finishOrder.includes(id)).map((id) => game.hands.get(id).length)
  );

  const nonBombPlays = plays.filter((p) => !p.isBomb);
  let candidates = nonBombPlays;
  if (!nonBombPlays.length) {
    // 봄만 낼 수 있는 상황 — 상대가 곧 끝날 것 같을 때 위주로만 실제 사용, 아니면 패스로 아낀다
    // (단, 소원 이행이 걸려 있으면 무조건 낸다 — 패스 불가)
    const shouldBomb = wishForced || othersMin <= 3 || Math.random() < 0.3;
    if (!shouldBomb) return { kind: 'pass' };
    candidates = plays;
  }

  let chosen;
  if (!current) {
    // 리드: 카드 수가 적은(=손에 여유를 남기는) 조합, 그중 랭크가 낮은 것부터 정리.
    // 개(랭크 0)와 불사조 리드(정적 값 1.5 — 응수할 때 쓰는 +0.5 이점 없이 그냥 최약체 싱글이
    // 됨)는 이 정렬에서 매번 1순위가 되어버리지만 실제로는 아껴뒀다 쓰는 카드라, 대부분은
    // 후보에서 빼고 가끔만 진짜로 리드에 사용한다. 특히 불사조를 리드로 던지는 건 와일드카드
    // 가치를 그냥 버리는 것이라 개보다도 더 드물게만 쓴다.
    const leadCands = candidates.filter((p) => {
      const special = p.length === 1 && p.cards[0].special;
      if (special === 'dog') return Math.random() < 0.15;
      if (special === 'phoenix') return Math.random() < 0.08;
      return true;
    });
    chosen = (leadCands.length ? leadCands : candidates)
      .slice().sort((a, b) => (a.length - b.length) || (a.rank - b.rank))[0];
  } else {
    chosen = candidates.reduce((best, p) => (p.rank < best.rank ? p : best));
  }

  const cardIds = chosen.cards.map((c) => c.id);
  const action = { kind: 'play', cardIds };
  if (chosen.cards.some((c) => c.special === 'mahjong')) {
    action.wish = Math.random() < 0.5 ? 11 + Math.floor(Math.random() * 4) : null;
  }
  return action;
}

/**
 * 자기 차례가 아닌 봇이 지금 봄(폭탄)으로 끼어들고 싶은지 결정. 없으면 null.
 * 우리 팀이 이미 이기고 있는 트릭엔 끼어들지 않고, 상대가 곧 끝날 것 같거나(손패 적음)
 * 트릭 가치가 클 때만 상대적으로 적극적으로, 그 외엔 드물게만 사용한다(봄은 아껴야 하는 자원).
 */
function chooseBombInterrupt(game, pid) {
  if (game.finished || game.phase !== 'trick' || !game.current) return null;
  if (game.finishOrder.includes(pid)) return null;
  const hand = game.hands.get(pid);
  if (!hand || !hand.length) return null;
  const bombs = core.validPlays(hand, game.current.combo).filter((p) => p.isBomb);
  if (!bombs.length) return null;

  const winnerTeam = game.teamOf.get(game.current.byId);
  if (winnerTeam === game.teamOf.get(pid)) return null; // 우리 팀이 이기는 트릭엔 끼어들지 않음

  const trickValue = core.handPoints(game.trickPile);
  const winnerHandLeft = game.hands.get(game.current.byId).length;
  const eager = winnerHandLeft <= 3 || trickValue >= 15;
  if (Math.random() >= (eager ? 0.5 : 0.08)) return null;

  const bomb4s = bombs.filter((b) => b.type === 'bomb4');
  const pool = bomb4s.length ? bomb4s : bombs; // 있으면 흔한 포카드 봄부터 아껴 쓴다
  const weakest = pool.reduce((best, b) => (b.rank < best.rank ? b : best));
  return { kind: 'play', cardIds: weakest.cards.map((c) => c.id) };
}

/** 봇의 다음 액션을 결정. index.js의 applyAction이 그대로 받아 처리할 수 있는 형태로 반환. */
function chooseBotAction(game, pid) {
  if (game.pendingWish === pid) return chooseWish(game, pid);
  if (game.pendingDragonGive === pid) return chooseDragonGive(game, pid);
  if (game.phase === 'grand_declare' && game.grandPending.has(pid)) return chooseGrandTichu(game, pid);
  if (game.phase === 'exchange' && !game.exchangeSubmitted.has(pid)) return chooseExchange(game, pid);

  if (game.phase === 'trick' && !game.hasPlayedCard.has(pid) && game.grandTichu.get(pid) !== true &&
      !game.tichu.get(pid) && Math.random() < 0.12) {
    return { kind: 'tichu' };
  }
  return choosePlayOrPass(game, pid);
}

module.exports = { chooseBotAction, chooseBombInterrupt };
