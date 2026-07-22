/**
 * 렉시오(LEXIO) 룰 엔진 — 서버(Node)와 브라우저에서 공용으로 사용.
 *
 * 숫자 세기: 3(최저) < 4 < ... < 15 < 1 < 2(최고)
 * 무늬 세기: 구름 < 별 < 달 < 해
 * 제출 단위: 1, 2, 3, 5개 (4개 불가)
 * 5개 조합: 스트레이트 < 플러쉬 < 풀하우스 < 포카드 < 스트레이트플러쉬
 * 스트레이트 서열: [1,2,3,4,5] > [2,3,4,5,6] > [max-3..max,1] > 나머지(끝수가 큰 순)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LexioCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['cloud', 'star', 'moon', 'sun']; // index === 무늬 세기
  const SUIT_STRENGTH = { cloud: 0, star: 1, moon: 2, sun: 3 };
  const SUIT_LABEL = { sun: '해', moon: '달', star: '별', cloud: '구름' };
  const SUIT_SYMBOL = { sun: '☀', moon: '☾', star: '★', cloud: '☁' };
  const TYPE_LABEL = {
    single: '싱글', pair: '페어', triple: '트리플',
    straight: '스트레이트', flush: '플러쉬', fullhouse: '풀하우스',
    four: '포카드', straightflush: '스트레이트플러쉬',
  };
  const FIVE_RANK = { straight: 0, flush: 1, fullhouse: 2, four: 3, straightflush: 4 };

  function maxNumberFor(playerCount) {
    return playerCount <= 3 ? 9 : playerCount === 4 ? 13 : 15;
  }

  function buildDeck(maxN) {
    const deck = [];
    for (const suit of SUITS)
      for (let num = 1; num <= maxN; num++)
        deck.push({ id: suit + '-' + num, suit, num });
    return deck;
  }

  function numRank(num, maxN) {
    return num >= 3 ? num - 3 : num === 1 ? maxN - 2 : maxN - 1;
  }

  function tileStrength(tile, maxN) {
    return numRank(tile.num, maxN) * 4 + SUIT_STRENGTH[tile.suit];
  }

  function sortTiles(tiles, maxN) {
    return tiles.slice().sort((a, b) => tileStrength(a, maxN) - tileStrength(b, maxN));
  }

  function straightSequences(maxN) {
    const seqs = [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]];
    for (let t = 7; t <= maxN; t++) seqs.push([t - 4, t - 3, t - 2, t - 1, t]);
    seqs.push([maxN - 3, maxN - 2, maxN - 1, maxN, 1]); // 1은 max 다음 수로도 사용 가능
    return seqs;
  }

  function straightValue(nums, maxN) {
    const s = nums.slice().sort((a, b) => a - b);
    const eq = (arr) => arr.slice().sort((a, b) => a - b).every((v, i) => v === s[i]);
    if (eq([1, 2, 3, 4, 5])) return 10000;
    if (eq([2, 3, 4, 5, 6])) return 9999;
    if (eq([1, maxN - 3, maxN - 2, maxN - 1, maxN])) return 9998;
    for (let i = 1; i < 5; i++) if (s[i] !== s[i - 1] + 1) return null;
    return s[4];
  }

  function makeCombo(type, tiles, rank) {
    return { type, count: tiles.length, tiles, rank };
  }

  /** tiles 배열이 유효한 조합이면 combo 객체, 아니면 null */
  function analyze(tiles, maxN) {
    const n = tiles.length;
    if (n !== 1 && n !== 2 && n !== 3 && n !== 5) return null;
    const sorted = sortTiles(tiles, maxN);
    const nums = sorted.map((t) => t.num);

    if (n === 1) return makeCombo('single', sorted, [tileStrength(sorted[0], maxN)]);
    if (n === 2) {
      if (nums[0] !== nums[1]) return null;
      const maxSuit = Math.max(SUIT_STRENGTH[sorted[0].suit], SUIT_STRENGTH[sorted[1].suit]);
      return makeCombo('pair', sorted, [numRank(nums[0], maxN), maxSuit]);
    }
    if (n === 3) {
      if (nums[0] !== nums[1] || nums[1] !== nums[2]) return null;
      return makeCombo('triple', sorted, [numRank(nums[0], maxN)]);
    }

    // 5개 조합
    const groups = {};
    for (const t of sorted) (groups[t.num] = groups[t.num] || []).push(t);
    const sizes = Object.values(groups).map((g) => g.length).sort((a, b) => b - a);

    if (sizes[0] === 4) {
      const quadNum = +Object.keys(groups).find((k) => groups[k].length === 4);
      return makeCombo('four', sorted, [FIVE_RANK.four, numRank(quadNum, maxN)]);
    }
    if (sizes[0] === 3 && sizes[1] === 2) {
      const tripNum = +Object.keys(groups).find((k) => groups[k].length === 3);
      return makeCombo('fullhouse', sorted, [FIVE_RANK.fullhouse, numRank(tripNum, maxN)]);
    }

    const isFlush = sorted.every((t) => t.suit === sorted[0].suit);
    const sv = sizes[0] === 1 ? straightValue(nums, maxN) : null;
    const top = sorted[sorted.length - 1]; // 세기 기준 가장 높은 타일 (무늬 동점 비교용)

    if (sv !== null && isFlush)
      return makeCombo('straightflush', sorted, [FIVE_RANK.straightflush, sv, SUIT_STRENGTH[top.suit]]);
    if (sv !== null)
      return makeCombo('straight', sorted, [FIVE_RANK.straight, sv, SUIT_STRENGTH[top.suit]]);
    if (isFlush)
      return makeCombo('flush', sorted, [FIVE_RANK.flush, numRank(top.num, maxN), SUIT_STRENGTH[top.suit]]);
    return null;
  }

  function cmpRank(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  /** a가 b를 이기는가 (같은 개수여야 함) */
  function beats(a, b) {
    return !!a && !!b && a.count === b.count && cmpRank(a.rank, b.rank) > 0;
  }

  function combinations(arr, k) {
    const res = [];
    (function rec(start, acc) {
      if (acc.length === k) { res.push(acc.slice()); return; }
      for (let i = start; i <= arr.length - (k - acc.length); i++) {
        acc.push(arr[i]);
        rec(i + 1, acc);
        acc.pop();
      }
    })(0, []);
    return res;
  }

  function groupByNum(hand) {
    const g = {};
    for (const t of hand) (g[t.num] = g[t.num] || []).push(t);
    return g;
  }

  /** 손패에서 count개짜리 유효 조합 전부 열거 */
  function enumeratePlays(hand, count, maxN) {
    const res = [];
    const push = (tiles) => {
      const c = analyze(tiles, maxN);
      if (c) res.push(c);
    };
    if (count === 1) {
      for (const t of hand) push([t]);
      return res;
    }
    if (count === 2 || count === 3) {
      const groups = groupByNum(hand);
      for (const g of Object.values(groups))
        if (g.length >= count) for (const c of combinations(g, count)) push(c);
      return res;
    }
    if (count !== 5) return res;

    const groups = groupByNum(hand);
    const seen = new Set();
    const add = (tiles) => {
      const key = tiles.map((t) => t.id).sort().join(',');
      if (seen.has(key)) return;
      seen.add(key);
      push(tiles);
    };
    // 포카드
    for (const [numS, g] of Object.entries(groups)) {
      if (g.length >= 4)
        for (const quad of combinations(g, 4))
          for (const k of hand) if (k.num !== +numS) add(quad.concat([k]));
    }
    // 풀하우스
    const numsKeys = Object.keys(groups);
    for (const a of numsKeys) {
      if (groups[a].length < 3) continue;
      for (const trip of combinations(groups[a], 3))
        for (const b of numsKeys) {
          if (b === a || groups[b].length < 2) continue;
          for (const pr of combinations(groups[b], 2)) add(trip.concat(pr));
        }
    }
    // 스트레이트(+스트레이트플러쉬)
    for (const seq of straightSequences(maxN)) {
      if (!seq.every((n) => groups[n] && groups[n].length)) continue;
      let acc = [[]];
      for (const n of seq) {
        const next = [];
        for (const partial of acc) for (const t of groups[n]) next.push(partial.concat([t]));
        acc = next;
      }
      for (const tiles of acc) add(tiles);
    }
    // 플러쉬
    const bySuit = {};
    for (const t of hand) (bySuit[t.suit] = bySuit[t.suit] || []).push(t);
    for (const g of Object.values(bySuit))
      if (g.length >= 5) for (const c of combinations(g, 5)) add(c);
    return res;
  }

  /**
   * 현재 테이블(current: {count, rank} 또는 null)을 이길 수 있는 모든 플레이.
   * current가 null이면(선) 모든 조합.
   */
  function validPlays(hand, current, maxN) {
    if (!current) {
      let all = [];
      for (const c of [1, 2, 3, 5]) all = all.concat(enumeratePlays(hand, c, maxN));
      return all;
    }
    return enumeratePlays(hand, current.count, maxN).filter((c) => beats(c, current));
  }

  /** 유효 플레이에 참여 가능한 타일 id 집합 (낼 수 있는 패 표시용) */
  function playableTileIds(hand, current, maxN) {
    const s = new Set();
    for (const p of validPlays(hand, current, maxN))
      for (const t of p.tiles) s.add(t.id);
    return s;
  }

  function describeCombo(combo) {
    if (!combo) return '';
    if (combo.type === 'single') return TYPE_LABEL.single + ' ' + combo.tiles[0].num;
    if (combo.type === 'pair' || combo.type === 'triple')
      return TYPE_LABEL[combo.type] + ' ' + combo.tiles[0].num;
    return TYPE_LABEL[combo.type];
  }

  return {
    SUITS, SUIT_STRENGTH, SUIT_LABEL, SUIT_SYMBOL, TYPE_LABEL, FIVE_RANK,
    maxNumberFor, buildDeck, numRank, tileStrength, sortTiles,
    straightSequences, straightValue, analyze, beats, cmpRank,
    enumeratePlays, validPlays, playableTileIds, describeCombo, groupByNum, combinations,
  };
});
