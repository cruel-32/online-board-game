'use strict';
/**
 * 노땡스 봇 수 결정. 반환: {action:'take'} | {action:'pass'}
 * 단순 규칙 기반: 이어붙일 수 있는 카드·이미 이득인 카드는 가져가고, 그 외엔 부담 정도에 따라 확률적으로 판단한다.
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

  // 남은 칩이 넉넉할수록 버티고, 부담이 작을수록(또는 칩이 바닥날수록) 가져가는 쪽으로 기운다
  const takeThreshold = 2 + Math.floor(myChips / 4);
  if (effectiveCost <= takeThreshold && Math.random() < 0.55) return { action: 'take' };
  return { action: 'pass' };
}

module.exports = { chooseBotMove };
