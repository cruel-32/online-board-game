'use strict';
/**
 * 우노 봇 — 낼 수 있는 카드가 있으면 내고(가능하면 색을 맞춰 손패 정리), 없으면 뽑는다.
 * 반환: {kind:'play', cardId, color?} | {kind:'draw'} | {kind:'pass'}
 */
const { COLORS } = require('./game');

// 손패에서 가장 많은 색 → 와일드로 바꿀 색 선택
function bestColor(hand) {
  const cnt = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of hand) if (c.color) cnt[c.color]++;
  return COLORS.reduce((a, b) => (cnt[b] > cnt[a] ? b : a), COLORS[0]);
}

function chooseBotMove(game, pid) {
  const hand = game.handOf(pid);

  // 방금 뽑은 카드만 낼 수 있는 상황
  if (game.justDrew && game.justDrew.pid === pid) {
    const c = hand.find((x) => x.id === game.justDrew.cardId);
    if (c && game.playable(c)) {
      const color = (c.type === 'wild' || c.type === 'wild4') ? bestColor(hand) : undefined;
      return { kind: 'play', cardId: c.id, color };
    }
    return { kind: 'pass' };
  }

  const playables = hand.filter((c) => game.playable(c));
  if (!playables.length) return { kind: 'draw' };

  // 우선순위: 숫자/기호(색 맞춤) 먼저, 와일드는 아껴서 마지막에
  const nonWild = playables.filter((c) => c.type !== 'wild' && c.type !== 'wild4');
  const pick = (nonWild.length ? nonWild : playables)
    // 점수 높은(부담되는) 카드부터 처리
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a))[0];
  const color = (pick.type === 'wild' || pick.type === 'wild4') ? bestColor(hand) : undefined;
  return { kind: 'play', cardId: pick.id, color };
}

function scoreOf(c) {
  if (c.type === 'number') return c.num;
  if (c.type === 'wild' || c.type === 'wild4') return 50;
  return 20;
}

module.exports = { chooseBotMove, bestColor };
