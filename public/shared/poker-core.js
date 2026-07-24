/**
 * 포커 공용 코어 — 홀덤/세븐포커가 함께 쓰는 카드·핸드 평가 엔진 (서버 Node + 브라우저 공용).
 * 카드: { rank: 2..14 (J11 Q12 K13 A14), suit: 's'|'h'|'d'|'c', id }
 * 핸드 평가: 5~7장 중 최고 5장을 골라 [카테고리, 타이브레이크...] 점수 배열을 만든다.
 *   카테고리: 0 하이카드,1 원페어,2 투페어,3 트리플,4 스트레이트,5 플러시,6 풀하우스,7 포카드,8 스트레이트플러시
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PokerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['s', 'h', 'd', 'c'];
  const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const CATEGORY_NAME = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

  function rankLabel(r) { return RANK_LABEL[r] || String(r); }

  function buildDeck() {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s, id: r + s });
    return deck;
  }

  // 5장 평가 → [category, tie1, tie2, ...]
  function evaluate5(cards) {
    const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
    const suits = cards.map((c) => c.suit);
    const isFlush = suits.every((s) => s === suits[0]);

    // 숫자별 개수
    const cnt = {};
    for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
    // [개수, 숫자] 내림차순(개수 우선, 같으면 숫자)
    const groups = Object.keys(cnt).map((r) => [cnt[r], +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);

    // 스트레이트 판정(휠 A-2-3-4-5 포함)
    const uniq = [...new Set(ranks)].sort((a, b) => b - a);
    let straightHigh = 0;
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // 휠
    }

    if (straightHigh && isFlush) return [8, straightHigh];
    if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
    if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]];
    if (isFlush) return [5, ...ranks];
    if (straightHigh) return [4, straightHigh];
    if (groups[0][0] === 3) return [3, groups[0][1], ...groups.slice(1).map((g) => g[1])];
    if (groups[0][0] === 2 && groups[1][0] === 2) {
      const hi = Math.max(groups[0][1], groups[1][1]);
      const lo = Math.min(groups[0][1], groups[1][1]);
      return [2, hi, lo, groups[2][1]];
    }
    if (groups[0][0] === 2) return [1, groups[0][1], ...groups.slice(1).map((g) => g[1])];
    return [0, ...ranks];
  }

  function compareScore(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  // n장(5~7) 중 최고 5장 점수. 반환 { score, cards }
  function combos(arr, k) {
    const res = [];
    const rec = (start, chosen) => {
      if (chosen.length === k) { res.push(chosen.slice()); return; }
      for (let i = start; i < arr.length; i++) { chosen.push(arr[i]); rec(i + 1, chosen); chosen.pop(); }
    };
    rec(0, []);
    return res;
  }

  function evaluateBest(cards) {
    if (cards.length < 5) throw new Error('5장 이상이어야 합니다.');
    let best = null, bestCards = null;
    for (const five of combos(cards, 5)) {
      const sc = evaluate5(five);
      if (!best || compareScore(sc, best) > 0) { best = sc; bestCards = five; }
    }
    return { score: best, cards: bestCards, name: CATEGORY_NAME[best[0]] };
  }

  return {
    SUITS, RANKS, RANK_LABEL, SUIT_SYMBOL, CATEGORY_NAME,
    rankLabel, buildDeck, evaluate5, evaluateBest, compareScore, combos,
  };
});
