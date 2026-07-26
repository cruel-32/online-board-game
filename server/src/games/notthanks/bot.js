'use strict';
/**
 * 노땡스 봇 수 결정. 반환: {action:'take'} | {action:'pass'}
 * 단순 규칙 기반이지만, 아래 요소들을 함께 고려한다:
 *  - 내 카드와 이어붙는 카드(또는 이미 이득인 카드)는 무조건 가져간다.
 *  - 노땡스는 모든 플레이어의 카드가 공개 정보이므로, 상대방 카드와 이어붙는데 아직 판돈(칩)이
 *    거의 안 쌓였다면 공짜로 넘겨주지 않도록 좀 더 적극적으로 가로챈다.
 *  - 부담(카드 숫자 − 쌓인 칩)이 문턱에 가까울수록 확률을 부드럽게 낮춰(급격한 컷오프 대신) 자연스럽게 판단한다.
 *  - 덱이 얼마 남지 않아 게임이 곧 끝날 때는 칩을 아껴봐야 쓸 곳이 줄어드므로 조금 더 적극적으로 정리한다.
 *  - 너무 소극적으로 패스만 반복하면 전원 칩이 금방 바닥나 게임이 어색해지므로, 가져가는 문턱을 넉넉히 잡는다.
 */
function chooseBotMove(game, pid) {
  const card = game.current;
  const pot = game.pot;
  const myChips = game.chips.get(pid);

  if (myChips <= 0) return { action: 'take' }; // 칩이 없으면 강제로 가져가야 함

  const myCards = game.cardsOwned.get(pid);
  const connectsMine = myCards.some((c) => c === card - 1 || c === card + 1);
  if (connectsMine) return { action: 'take' }; // 내 카드와 이어붙어 사실상 이득

  const effectiveCost = card - pot; // 지금 가져갈 때 실제로 부담하는 점수(대략치, 연속 보너스는 무시)
  if (effectiveCost <= 0) return { action: 'take' }; // 쌓인 칩이 카드 숫자 이상 → 가져가도 손해가 없음

  // 다른 플레이어의 카드와 이어붙는데(공개 정보라 알 수 있음) 판돈이 아직 얼마 안 쌓였다면,
  // 상대가 싸게 가져가 이득 보지 않도록 절반 확률로 먼저 가로챈다.
  const connectsOther = game.playerIds.some(
    (oid) => oid !== pid && game.cardsOwned.get(oid).some((c) => c === card - 1 || c === card + 1)
  );
  if (connectsOther && pot <= 2 && Math.random() < 0.5) return { action: 'take' };

  if (effectiveCost <= 10) return { action: 'take' }; // 부담이 작은 카드는 그냥 가져간다

  // 덱이 얼마 안 남아 게임이 곧 끝나면 칩을 아낄 이유가 줄어드므로 문턱을 조금 더 높인다.
  const endgame = game.deck.length <= 5;
  const takeThreshold = (endgame ? 14 : 10) + Math.floor(myChips / 2);
  if (effectiveCost <= takeThreshold) {
    // 문턱에 가까울수록 확률을 낮추고, 여유 있을수록 자주 가져가는 부드러운 곡선(0.4~0.8)
    const margin = (takeThreshold - effectiveCost) / takeThreshold;
    if (Math.random() < 0.4 + 0.4 * margin) return { action: 'take' };
  }

  // 칩이 얼마 남지 않았다면(패스만 반복하다 강제로 나쁜 카드를 떠안기 전에) 가끔은 비싼 카드도 감수한다
  if (myChips <= 4 && Math.random() < 0.4) return { action: 'take' };

  return { action: 'pass' };
}

module.exports = { chooseBotMove };
