'use strict';
/**
 * 홀덤 봇 — 핸드 강도(0~1)를 추정해 폴드/체크/콜/레이즈를 결정한다.
 * 반환: {kind:'fold'|'check'|'call'} | {kind:'raise', amount}
 */
const poker = require('../../../../public/shared/poker-core.js');

const CAT_STRENGTH = [0.16, 0.38, 0.54, 0.64, 0.74, 0.82, 0.9, 0.96, 0.99];

function estimateStrength(game, seat) {
  const board = game.board;
  if (board.length === 0) {
    // 프리플롭: 홀 카드 두 장으로 대략 평가
    const [a, b] = seat.hole;
    const hi = Math.max(a.rank, b.rank), lo = Math.min(a.rank, b.rank);
    if (a.rank === b.rank) return Math.min(0.99, 0.5 + a.rank / 28);      // 페어
    let s = (hi + lo) / 40;                                              // 하이카드 기반
    if (a.suit === b.suit) s += 0.08;                                    // 수딧
    if (hi - lo === 1) s += 0.06;                                        // 커넥터
    if (hi >= 13) s += 0.05;                                             // A/K 포함
    return Math.min(0.62, s);
  }
  const best = poker.evaluateBest([...seat.hole, ...board]);
  let s = CAT_STRENGTH[best.score[0]];
  // 하이카드/원페어는 탑카드 높이에 따라 소폭 가감
  if (best.score[0] <= 1) s += (best.score[1] - 8) / 120;
  return Math.max(0.05, Math.min(0.99, s));
}

function chooseBotMove(game, pid) {
  const opt = game.options(pid);
  const seat = game.seatById(pid);
  if (!opt) return { kind: 'check' };
  const strength = estimateStrength(game, seat);
  const pot = game.potTotal();
  const r = Math.random();

  const raiseAmount = () => {
    const size = Math.round(pot * 0.6) + opt.betToMatch;
    return Math.max(opt.minRaiseTo, Math.min(opt.maxRaiseTo, size));
  };

  if (opt.canCheck) {
    // 낼 것 없음: 강하면 가끔 벳, 아니면 체크
    if (strength > 0.62 && opt.canRaise && r < 0.55) return { kind: 'raise', amount: raiseAmount() };
    return { kind: 'check' };
  }

  // 콜해야 하는 상황
  const callCost = opt.toCall;
  const potOdds = callCost / (pot + callCost || 1);
  if (strength > 0.8 && opt.canRaise && r < 0.5) return { kind: 'raise', amount: raiseAmount() };
  if (strength < 0.22) return { kind: 'fold' };
  if (strength >= potOdds * 0.85 || r < 0.15) return { kind: 'call' };
  return { kind: 'fold' };
}

module.exports = { chooseBotMove, estimateStrength };
