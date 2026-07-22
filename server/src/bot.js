'use strict';
const core = require('../../public/shared/lexio-core.js');

function lowestBy(plays) {
  return plays.reduce((best, p) => (core.cmpRank(p.rank, best.rank) < 0 ? p : best));
}
function highestBy(plays) {
  return plays.reduce((best, p) => (core.cmpRank(p.rank, best.rank) > 0 ? p : best));
}

/**
 * 봇 수 결정. 반환: {action:'pass'} | {action:'play', tileIds:[...]}
 */
function chooseBotMove(game, pid) {
  const hand = game.hands.get(pid);
  const current = game.current ? game.current.combo : null;
  const plays = core.validPlays(hand, current, game.maxN);
  if (!plays.length) return { action: 'pass' };

  const othersMin = Math.min(
    ...game.playerIds.filter((id) => id !== pid).map((id) => game.hands.get(id).length)
  );

  if (!current) {
    // 선: 많이 버릴 수 있는 조합부터, 그중 가장 약한 것
    for (const c of [5, 3, 2, 1]) {
      const ofCount = plays.filter((p) => p.count === c);
      if (!ofCount.length) continue;
      let cands = ofCount;
      if (c === 1) {
        // 페어/트리플을 깨지 않는 싱글 우선
        const groups = core.groupByNum(hand);
        const loose = cands.filter((p) => groups[p.tiles[0].num].length === 1);
        if (loose.length) cands = loose;
        // 상대가 막판이면 높은 싱글로 견제
        if (othersMin <= 2) return { action: 'play', tileIds: highestBy(cands).tiles.map((t) => t.id) };
      }
      return { action: 'play', tileIds: lowestBy(cands).tiles.map((t) => t.id) };
    }
  }

  let cands = plays;
  if (current.count === 1) {
    const groups = core.groupByNum(hand);
    const loose = cands.filter((p) => groups[p.tiles[0].num].length === 1);
    if (loose.length) cands = loose;
    if (othersMin <= 2) return { action: 'play', tileIds: highestBy(cands).tiles.map((t) => t.id) };
  }
  // 손패가 넉넉한데 2를 소모해야만 이길 수 있으면 가끔 아낀다
  const best = lowestBy(cands);
  const usesTwo = best.tiles.some((t) => t.num === 2);
  if (usesTwo && hand.length > 6 && othersMin > 3 && Math.random() < 0.4) {
    return { action: 'pass' };
  }
  return { action: 'play', tileIds: best.tiles.map((t) => t.id) };
}

module.exports = { chooseBotMove };
