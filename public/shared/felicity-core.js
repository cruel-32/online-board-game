/**
 * 펠리시티(자루 속 고양이) 규칙 엔진 — 서버(Node)와 브라우저 공용.
 *
 * 카드 구성(색깔별 10장): 고양이 7장(-8,-5,3,5,8,11,15), 토끼 1장(0), 큰 개·작은 개 각 1장.
 * 각자 한 색을 골라 그 색 10장을 갖고, 오른쪽 이웃 손에서 1장 무작위 제거 → 각자 9장(=9라운드).
 * 매 라운드: 전원이 카드 1장을 뒷면으로 놓아 "자루"를 만들고, 경매로 자루의 주인을 정한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FelicityCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];
  const COLOR_LABEL = { red: '빨강', blue: '파랑', green: '초록', yellow: '노랑', purple: '보라' };
  const COLOR_HEX = { red: '#e2564d', blue: '#4d8fe2', green: '#4dae5e', yellow: '#e0b83c', purple: '#9b6fe0' };
  const CAT_VALUES = [-8, -5, 3, 5, 8, 11, 15];
  const COINS_PER_PLAYER = 15;
  const ROUNDS = 9;

  // 색깔별 10장 덱
  function buildColorDeck(color) {
    const cards = [];
    for (const v of CAT_VALUES) cards.push({ id: `${color}-cat-${v}`, color, kind: 'cat', value: v });
    cards.push({ id: `${color}-rabbit`, color, kind: 'rabbit', value: 0 });
    cards.push({ id: `${color}-dogbig`, color, kind: 'dog', size: 'big', value: 0 });
    cards.push({ id: `${color}-dogsmall`, color, kind: 'dog', size: 'small', value: 0 });
    return cards;
  }

  // 인원별 쥐 카드 숫자 배열(오름차순). 슬롯 수 = 1(자루) + 쥐카드 수 = 인원수.
  // 5인: 2,3,4,6 / 4인: 2,4,6
  function mouseCardsFor(playerCount) {
    if (playerCount === 5) return [2, 3, 4, 6];
    if (playerCount === 4) return [2, 4, 6];
    return [2, 3, 4, 6]; // 그 외(테스트)
  }

  function bankTotalFor(playerCount) {
    if (playerCount === 5) return 33;
    if (playerCount === 4) return 27;
    return 33;
  }

  /**
   * 자루(획득 카드 묶음)에 대한 개/토끼 효과 처리.
   * 반환: { removed:[제거된 카드], kept:[남는 카드] }
   */
  function resolveDogs(bag) {
    const dogs = bag.filter((c) => c.kind === 'dog');
    const removed = [];
    if (dogs.length >= 2) {
      removed.push(...dogs); // 개 2장 이상 → 개만 제거
    } else if (dogs.length === 1) {
      removed.push(dogs[0]);
      const cats = bag.filter((c) => c.kind === 'cat');
      let target = null;
      if (dogs[0].size === 'big') {
        const pos = cats.filter((c) => c.value > 0);
        if (pos.length) target = pos.reduce((a, b) => (b.value > a.value ? b : a));
        else if (cats.length) target = cats.reduce((a, b) => (b.value > a.value ? b : a)); // 음수 중 최고값(0에 가까움)
      } else {
        const neg = cats.filter((c) => c.value < 0);
        if (neg.length) target = neg.reduce((a, b) => (b.value < a.value ? b : a));
        else if (cats.length) target = cats.reduce((a, b) => (b.value < a.value ? b : a)); // 양수 중 최저값
      }
      if (target) removed.push(target);
    }
    const removedIds = new Set(removed.map((c) => c.id));
    const kept = bag.filter((c) => !removedIds.has(c.id));
    return { removed, kept };
  }

  // 카드 점수: 고양이 값, 토끼 0, 개 0(어차피 제거됨)
  function cardPoints(card) {
    return card.kind === 'cat' ? card.value : 0;
  }

  // 최종 점수: 모은 카드 포인트 합 + 남은 코인 수
  function scoreOf(collected, coins) {
    const cardPts = collected.reduce((s, c) => s + cardPoints(c), 0);
    return { cardPts, coins, total: cardPts + coins };
  }

  return {
    COLORS, COLOR_LABEL, COLOR_HEX, CAT_VALUES, COINS_PER_PLAYER, ROUNDS,
    buildColorDeck, mouseCardsFor, bankTotalFor, resolveDogs, cardPoints, scoreOf,
  };
});
