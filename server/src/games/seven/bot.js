'use strict';
/**
 * 세븐 포커 봇 — 현재 보유 카드(다운+오픈)로 핸드 강도를 추정해 다이/체크/콜/벳/레이즈.
 */
const poker = require('../../../../public/shared/poker-core.js');
const CAT_STRENGTH = [0.16, 0.4, 0.58, 0.68, 0.76, 0.83, 0.9, 0.96, 0.99];

function estimateStrength(seat) {
  const cards = seat.cards.map((c) => c.card);
  if (cards.length >= 5) {
    const best = poker.evaluateBest(cards);
    let s = CAT_STRENGTH[best.score[0]];
    if (best.score[0] <= 1) s += (best.score[1] - 8) / 120;
    return Math.max(0.05, Math.min(0.99, s));
  }
  // 3~4장: 페어/하이카드 대략 평가
  const ranks = cards.map((c) => c.rank);
  const cnt = {}; for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
  const maxCnt = Math.max(...Object.values(cnt));
  const hi = Math.max(...ranks);
  if (maxCnt >= 3) return 0.7;
  if (maxCnt === 2) return 0.4 + hi / 60;
  return 0.15 + hi / 60;
}

function chooseBotMove(game, pid) {
  const opt = game.options(pid);
  const seat = game.seatById(pid);
  if (!opt) return { kind: 'check' };
  const strength = estimateStrength(seat);
  const pot = game.potTotal();
  const r = Math.random();
  const raiseAmount = () => Math.max(opt.minRaiseTo, Math.min(opt.maxRaiseTo, Math.round(pot * 0.5) + opt.betToMatch));

  if (opt.canCheck) {
    if (strength > 0.6 && opt.canRaise && r < 0.5) return { kind: 'raise', amount: raiseAmount() };
    return { kind: 'check' };
  }
  const callCost = opt.toCall;
  const potOdds = callCost / (pot + callCost || 1);
  if (strength > 0.82 && opt.canRaise && r < 0.5) return { kind: 'raise', amount: raiseAmount() };
  if (strength < 0.25) return { kind: 'fold' };
  if (strength >= potOdds * 0.85 || r < 0.12) return { kind: 'call' };
  return { kind: 'fold' };
}

module.exports = { chooseBotMove, estimateStrength };
