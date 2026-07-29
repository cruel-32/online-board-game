/**
 * 티츄(Tichu) 룰 엔진 — 서버(Node)와 브라우저에서 공용으로 사용.
 *
 * 카드 56장 = 4수트 × 13랭크(2~10,J=11,Q=12,K=13,A=14) + 특수 4장(마작=1, 개=0, 불사조, 드래곤=15).
 * 조합: 싱글/페어/트리플/풀하우스/스트레이트(5+)/계단(연속 페어, 4+ 짝수)/봄(포카드, 스트레이트플러쉬 5+).
 * 총 점수(5=5×4, 10=10×4, K=10×4, 드래곤=+25, 불사조=-25) 합계는 항상 100점.
 *
 * 설계 노트(모호한 공식 규칙 해석을 명시적으로 고정):
 * - 불사조가 페어/트리플/풀하우스/스트레이트/계단에 낄 때는 "그 랭크를 그대로 가짐"으로 취급하고
 *   가치를 더/덜 주지 않는다(동랭크 자연 조합과 완전 동점 = 서로 이길 수 없음).
 * - 불사조로 완성 가능한 해석이 여러 개면(예: 페어+페어+불사조 → 어느 쪽을 트리플로 볼지,
 *   스트레이트 확장 방향) 플레이어에게 가장 유리한(랭크가 가장 높은) 해석을 채택한다.
 * - 불사조 싱글의 랭크는 정적이지 않다: 리드일 때 1.5, 무언가를 이길 때는 "직전 싱글 랭크+0.5"
 *   (analyze()는 리드 값 1.5만 반환하고, Game이 컨텍스트를 알 때 resolvePhoenixSingleRank()로 재계산한다).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TichuCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['jade', 'sword', 'star', 'pagoda'];
  const SUIT_LABEL = { jade: '옥', sword: '검', star: '별', pagoda: '탑' };
  const SUIT_SYMBOL = { jade: '♣', sword: '♠', star: '♦', pagoda: '♥' };
  const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const TYPE_LABEL = {
    single: '싱글', pair: '페어', triple: '트리플', fullhouse: '풀하우스',
    straight: '스트레이트', stairs: '계단', bomb4: '포카드 봄', bombflush: '스트레이트플러쉬 봄',
  };

  function rankLabel(rank) {
    if (rank === 1) return '마작(1)';
    return RANK_LABEL[rank] || String(rank);
  }

  function cardLabel(card) {
    if (card.special === 'dog') return '강아지';
    if (card.special === 'dragon') return '드래곤';
    if (card.special === 'phoenix') return '불사조';
    if (card.special === 'mahjong') return '마작';
    return `${SUIT_LABEL[card.suit]}${rankLabel(card.rank)}`;
  }

  function buildDeck() {
    const deck = [];
    for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) deck.push({ id: `${suit}-${rank}`, suit, rank, special: null });
    deck.push({ id: 'mahjong', suit: null, rank: 1, special: 'mahjong' });
    deck.push({ id: 'dog', suit: null, rank: 0, special: 'dog' });
    deck.push({ id: 'phoenix', suit: null, rank: null, special: 'phoenix' });
    deck.push({ id: 'dragon', suit: null, rank: 15, special: 'dragon' });
    return deck;
  }

  function pointOf(card) {
    if (card.special === 'dragon') return 25;
    if (card.special === 'phoenix') return -25;
    if (card.special) return 0; // 마작/개
    if (card.rank === 5) return 5;
    if (card.rank === 10 || card.rank === 13) return 10;
    return 0;
  }

  function handPoints(cards) {
    return cards.reduce((s, c) => s + pointOf(c), 0);
  }

  // 정렬/표시용 고정 랭크(불사조는 K와 A 사이가 아니라 A 바로 위, 드래곤 바로 아래에 표시)
  function displayRank(card) {
    if (card.special === 'phoenix') return 14.5;
    return card.rank;
  }

  function sortCards(cards) {
    return cards.slice().sort((a, b) => {
      const d = displayRank(a) - displayRank(b);
      if (d) return d;
      return SUITS.indexOf(a.suit || '') - SUITS.indexOf(b.suit || '');
    });
  }

  function mk(type, cards, isBomb, rank) {
    return { type, length: cards.length, cards: cards.slice(), isBomb, rank };
  }

  function sameRankOf(cards, hasPhoenix) {
    const naturals = cards.filter((c) => c.special !== 'phoenix');
    if (hasPhoenix && naturals.length !== cards.length - 1) return null;
    const ranks = new Set(naturals.map((c) => c.rank));
    if (ranks.size !== 1) return null;
    return naturals[0].rank;
  }

  function tryFullHouse(cards, hasMahjong, hasPhoenix) {
    if (hasMahjong) return null;
    const naturals = cards.filter((c) => c.special !== 'phoenix');
    const groups = new Map();
    for (const c of naturals) groups.set(c.rank, (groups.get(c.rank) || 0) + 1);
    const entries = [...groups.entries()];
    if (entries.length !== 2) return null;
    const sizes = entries.map((e) => e[1]).slice().sort((a, b) => a - b);
    if (hasPhoenix) {
      if (sizes[0] === 1 && sizes[1] === 3) {
        return mk('fullhouse', cards, false, entries.find((e) => e[1] === 3)[0]);
      }
      if (sizes[0] === 2 && sizes[1] === 2) {
        // 어느 페어를 트리플로 볼지 모호함 → 랭크가 더 높은 쪽을 트리플로(플레이어에게 유리한 해석)
        return mk('fullhouse', cards, false, Math.max(entries[0][0], entries[1][0]));
      }
      return null;
    }
    if (sizes[0] === 2 && sizes[1] === 3) {
      return mk('fullhouse', cards, false, entries.find((e) => e[1] === 3)[0]);
    }
    return null;
  }

  function tryStraight(cards, hasMahjong, hasPhoenix) {
    const naturals = cards.filter((c) => c.special !== 'phoenix');
    const n = cards.length;
    const ranks = naturals.map((c) => c.rank);
    if (new Set(ranks).size !== ranks.length) return null;
    const sorted = ranks.slice().sort((a, b) => a - b);

    if (!hasPhoenix) {
      if (sorted.length !== n) return null;
      for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) return null;
      const top = sorted[sorted.length - 1];
      if (!hasMahjong) {
        const suits = new Set(naturals.map((c) => c.suit));
        if (suits.size === 1) return mk('bombflush', cards, true, top);
      }
      return mk('straight', cards, false, top);
    }

    if (sorted.length !== n - 1) return null;
    const candidates = [];
    for (const topCandidate of [sorted[sorted.length - 1], sorted[sorted.length - 1] + 1]) {
      const bottom = topCandidate - n + 1;
      if (bottom < 1) continue;
      if (hasMahjong && bottom !== 1) continue;
      if (!hasMahjong && bottom < 2) continue;
      if (topCandidate > 14) continue;
      const full = [];
      for (let v = bottom; v <= topCandidate; v++) full.push(v);
      const missing = full.filter((v) => !sorted.includes(v));
      const extra = sorted.filter((v) => !full.includes(v));
      if (missing.length === 1 && extra.length === 0) candidates.push(topCandidate);
    }
    if (!candidates.length) return null;
    return mk('straight', cards, false, Math.max(...candidates));
  }

  function tryStairs(cards, hasMahjong, hasPhoenix) {
    if (hasMahjong) return null;
    const n = cards.length;
    const pairsNeeded = n / 2;
    const naturals = cards.filter((c) => c.special !== 'phoenix');
    const groups = new Map();
    for (const c of naturals) groups.set(c.rank, (groups.get(c.rank) || 0) + 1);

    if (!hasPhoenix) {
      if (naturals.length !== n || groups.size !== pairsNeeded) return null;
      const ranks = [...groups.keys()].sort((a, b) => a - b);
      for (const r of ranks) if (groups.get(r) !== 2) return null;
      for (let i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i - 1] + 1) return null;
      return mk('stairs', cards, false, ranks[ranks.length - 1]);
    }

    if (naturals.length !== n - 1 || groups.size !== pairsNeeded) return null;
    const ranks = [...groups.keys()].sort((a, b) => a - b);
    for (let i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i - 1] + 1) return null;
    let singleCount = 0;
    for (const r of ranks) {
      const c = groups.get(r);
      if (c === 2) continue;
      if (c === 1) { singleCount++; continue; }
      return null;
    }
    if (singleCount !== 1) return null;
    return mk('stairs', cards, false, ranks[ranks.length - 1]);
  }

  /** cards 배열이 유효한 조합이면 combo 객체({type,length,cards,isBomb,rank}), 아니면 null */
  function analyze(cards) {
    if (!Array.isArray(cards) || !cards.length) return null;
    const n = cards.length;
    if (cards.some((c) => c.special === 'dog')) return n === 1 ? mk('single', cards, false, 0) : null;
    if (cards.some((c) => c.special === 'dragon')) return n === 1 ? mk('single', cards, false, 15) : null;

    if (n === 1) {
      const c = cards[0];
      if (c.special === 'mahjong') return mk('single', cards, false, 1);
      if (c.special === 'phoenix') return mk('single', cards, false, 1.5); // 리드 값(응수 시 Game이 재계산)
      return mk('single', cards, false, c.rank);
    }

    const hasMahjong = cards.some((c) => c.special === 'mahjong');
    const hasPhoenix = cards.some((c) => c.special === 'phoenix');

    if (n === 2 && !hasMahjong) {
      const r = sameRankOf(cards, hasPhoenix);
      if (r != null) return mk('pair', cards, false, r);
    }
    if (n === 3 && !hasMahjong) {
      const r = sameRankOf(cards, hasPhoenix);
      if (r != null) return mk('triple', cards, false, r);
    }
    if (n === 4 && !hasMahjong && !hasPhoenix) {
      const r = sameRankOf(cards, false);
      if (r != null) return mk('bomb4', cards, true, r);
    }
    if (n === 5) {
      const fh = tryFullHouse(cards, hasMahjong, hasPhoenix);
      if (fh) return fh;
    }
    if (n >= 5) {
      const st = tryStraight(cards, hasMahjong, hasPhoenix);
      if (st) return st;
    }
    if (n >= 4 && n % 2 === 0) {
      const stairs = tryStairs(cards, hasMahjong, hasPhoenix);
      if (stairs) return stairs;
    }
    return null;
  }

  /** 리드 직후(=1.5) 또는 응수(=현재 싱글 랭크+0.5) 상황에서 불사조 싱글의 실제 랭크 */
  function resolvePhoenixSingleRank(current) {
    if (!current) return 1.5;
    // 드래곤(15)은 항상 최고 싱글 — 불사조도 이길 수 없다(랭크를 올리지 않아 beats()가 자동으로 거부).
    if (current.rank >= 15) return current.rank;
    return current.rank + 0.5;
  }

  /** a가 b를 이기는가. b=null이면 리드이므로 항상 true. */
  function beats(a, b) {
    if (!a) return false;
    if (!b) return true;
    if (a.isBomb && !b.isBomb) return true;
    if (!a.isBomb && b.isBomb) return false;
    if (a.isBomb && b.isBomb) {
      if (a.type !== b.type) return a.type === 'bombflush';
      if (a.type === 'bombflush') {
        if (a.length !== b.length) return a.length > b.length;
        return a.rank > b.rank;
      }
      return a.rank > b.rank; // bomb4 vs bomb4
    }
    if (a.type !== b.type || a.length !== b.length) return false;
    return a.rank > b.rank;
  }

  /** 손패의 모든 부분집합 중 유효한 조합 전부 (n<=14라 브루트포스로 충분히 빠름) */
  function enumerateAllCombos(hand) {
    const n = hand.length;
    const results = [];
    const total = 1 << n;
    for (let mask = 1; mask < total; mask++) {
      const subset = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(hand[i]);
      const c = analyze(subset);
      if (c) results.push(c);
    }
    return results;
  }

  /** current(=null이면 리드)를 이길 수 있는 손패의 모든 조합 */
  function validPlays(hand, current) {
    const all = enumerateAllCombos(hand);
    if (!current) return all;
    return all.filter((c) => beats(c, current));
  }

  /** wishRank를 만족(자연카드 포함)하는 유효 플레이가 있는지 */
  function hasWishFulfillingPlay(hand, current, wishRank) {
    if (wishRank == null) return false;
    return validPlays(hand, current).some((c) => c.cards.some((card) => card.rank === wishRank && !card.special));
  }

  function describeCombo(combo) {
    if (!combo) return '';
    if (combo.type === 'single') {
      const c = combo.cards[0];
      return cardLabel(c);
    }
    if (combo.type === 'pair' || combo.type === 'triple' || combo.type === 'fullhouse')
      return `${TYPE_LABEL[combo.type]} ${rankLabel(combo.rank)}`;
    return `${TYPE_LABEL[combo.type]}(${combo.length}) ${rankLabel(combo.rank)}`;
  }

  return {
    SUITS, SUIT_LABEL, SUIT_SYMBOL, RANK_LABEL, TYPE_LABEL,
    rankLabel, cardLabel, buildDeck, pointOf, handPoints, displayRank, sortCards,
    analyze, beats, resolvePhoenixSingleRank,
    enumerateAllCombos, validPlays, hasWishFulfillingPlay, describeCombo,
  };
});
