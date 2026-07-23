'use strict';
/**
 * 펠리시티 봇 — 배치(어떤 카드를 뒷면으로 놓을지)와 경매(입찰/패스) 결정.
 * 반환: {kind:'place', cardId} | {kind:'bid', amount} | {kind:'pass'}
 */

// 카드 보관 선호도(낮을수록 먼저 버림): 개는 점수 0이라 우선 버리고, 그 다음 음수 고양이.
function keepValue(card) {
  if (card.kind === 'dog') return -100;
  return card.value; // 고양이/토끼
}

// 공개된 자루 카드로 대략적인 자루 가치를 추정.
function estimateBag(game) {
  const revealed = game.row.filter((s) => s.faceUp).map((s) => s.card);
  const hidden = game.row.length - revealed.length;
  const cats = revealed.filter((c) => c.kind === 'cat');
  let est = cats.reduce((s, c) => s + c.value, 0); // 토끼 0
  const dogs = revealed.filter((c) => c.kind === 'dog');
  if (dogs.length === 1) {
    if (dogs[0].size === 'big') {
      const pos = cats.filter((c) => c.value > 0);
      est -= pos.length ? Math.max(...pos.map((c) => c.value)) : 0; // 큰 개는 좋은 고양이를 쫓아냄
    } else {
      const neg = cats.filter((c) => c.value < 0);
      est += neg.length ? Math.abs(Math.min(...neg.map((c) => c.value))) : 0; // 작은 개는 나쁜 고양이를 없애줌(이득)
    }
  }
  // 숨은 카드는 소폭 낙관적으로 가정
  est += hidden * 1;
  return est;
}

function chooseBotMove(game, pid) {
  if (game.phase === 'placing') {
    const hand = game.hands.get(pid);
    // 보관 선호도가 가장 낮은 카드를 버린다(개 → 음수 고양이 순).
    const card = hand.slice().sort((a, b) => keepValue(a) - keepValue(b))[0];
    return { kind: 'place', cardId: card.id };
  }

  if (game.phase === 'bidding') {
    const coins = game.coins.get(pid);
    const high = game.highBid;
    const est = estimateBag(game) + (Math.random() * 2 - 1); // 약간의 무작위성
    const next = high + 1;
    if (est > high && next <= coins && next <= est + 0.5) {
      return { kind: 'bid', amount: next };
    }
    return { kind: 'pass' };
  }

  return { kind: 'pass' };
}

module.exports = { chooseBotMove, estimateBag, keepValue };
