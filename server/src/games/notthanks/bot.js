'use strict';
/**
 * 노땡스 봇 수 결정. 반환: {action:'take'} | {action:'pass'}
 * 단순 규칙 기반: 이어붙일 수 있는 카드·이미 이득인 카드는 적극적으로 가져가고,
 * 그 외엔 부담 정도와 남은 칩 사정에 따라 판단한다.
 * (너무 소극적으로 패스만 반복하면 전원 칩이 금방 바닥나 게임이 어색해지므로, 가져가는 문턱을 넉넉히 잡는다)
 */
function chooseBotMove(game, pid) {
  const card = game.current;
  const pot = game.pot;
  const myChips = game.chips.get(pid);

  if (myChips <= 0) return { action: 'take' }; // 칩이 없으면 강제로 가져가야 함

  const myCards = game.cardsOwned.get(pid);
  const connects = myCards.some((c) => c === card - 1 || c === card + 1);
  if (connects) return { action: 'take' }; // 내 카드와 이어붙어 사실상 이득

  const effectiveCost = card - pot; // 지금 가져갈 때 실제로 부담하는 점수(대략치, 연속 보너스는 무시)
  if (effectiveCost <= 0) return { action: 'take' }; // 쌓인 칩이 카드 숫자 이상 → 가져가도 손해가 없음
  if (effectiveCost <= 10) return { action: 'take' }; // 부담이 작은 카드는 그냥 가져간다

  // 남은 칩이 넉넉할수록 버티고, 부담이 클수록 패스 쪽으로 기울되, 문턱을 넓게 잡아 너무 오래 패스만
  // 반복해 칩이 급격히 소진되지 않도록 한다.
  const takeThreshold = 10 + Math.floor(myChips / 2);
  if (effectiveCost <= takeThreshold && Math.random() < 0.6) return { action: 'take' };

  // 칩이 얼마 남지 않았다면(패스만 반복하다 강제로 나쁜 카드를 떠안기 전에) 가끔은 비싼 카드도 감수한다
  if (myChips <= 4 && Math.random() < 0.35) return { action: 'take' };

  return { action: 'pass' };
}

module.exports = { chooseBotMove };
