# 보드게임 온라인 (Board Games Online)

여러 보드게임을 한 서비스에서 즐기는 온라인 멀티플레이 플랫폼입니다.
방을 만들 때 게임을 고르고, 대기실에서 방장이 언제든 게임을 바꿀 수 있습니다.
스마트폰 **가로 모드** 기준으로 설계되었으며 세로 모드도 지원합니다(아이폰 SE 화면에서도 UI가 잘리지 않습니다).

현재 지원 게임:
- **렉시오 (LEXIO)** — 3~5인. 손패를 먼저 모두 내려놓으면 이기는 조합 카드게임.
- **펠리시티 (자루 속 고양이)** — 4~5인. 9라운드 경매로 고양이 카드를 모아 최고 점수를 노리는 게임.

> 방/로비/채팅/음성/봇 같은 공용 기능 위에 게임별 규칙·UI를 플러그인으로 얹는 구조입니다.
> 새 게임 추가 방법과 전체 설계는 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)를 참고하세요.

## 실행 방법

### Docker (홈서버 배포)

```bash
docker compose up --build -d
# http://<서버주소>:8082 접속
```

앱(Node.js) + Redis + PostgreSQL이 함께 기동됩니다.
게임 결과는 PostgreSQL(`round_results` 테이블, `game_id` 포함)에 기록되고 Redis에 최근 결과가 캐시됩니다.

### 로컬 개발

```bash
npm install
npm run dev        # http://localhost:8080
npm test           # 규칙 엔진 단위 검증 + 봇 자동 대전 시뮬레이션
```

Redis/PostgreSQL 없이도 동작합니다. (`REDIS_URL`, `DATABASE_URL` 환경변수 설정 시 사용)

## 공통 기능

- **로비/대기룸**: 게임 선택 후 방 생성(비밀번호 선택), 초대 링크 복사, 방장 권한(게임 변경, 최대 인원 조절, 강퇴, 봇 추가/제거)
- **봇 플레이**: 인원이 부족하면 봇으로 채워 플레이 가능. 게임 중 이탈/접속 끊김 시 봇이 대신 진행
- **채팅 / 음성채팅**: 대기실·게임 화면 공용 위젯. 텍스트 채팅은 서버 중계, 음성은 참가자끼리 WebRTC로 직접 연결(P2P mesh)하며 서버는 시그널링만 중계.
  채팅 메시지는 보낸 사람 캐릭터 옆 말풍선으로도 잠시 표시됩니다.
  ⚠️ 마이크 접근은 브라우저 보안 정책상 HTTPS(또는 localhost) 접속에서만 동작합니다 — 홈서버에 도메인+TLS(리버스 프록시)를 붙여야 폰에서 사용 가능
- **효과음**: 합성 사운드 + 음성 안내(내 차례 등)
- **UI**: Canvas 렌더링, 가로/세로 모드 대응, 게임별 규칙 팝업

## 게임별 특징

### 렉시오
- 인원별 타일 범위(3인 1~9 / 4인 1~13 / 5인 1~15), 구름③ 선, 1·2·3·5개 제출,
  스트레이트<플러쉬<풀하우스<포카드<스트레이트플러쉬, 특수 스트레이트 서열, '1'의 특수기능, '2' 검사(남은 타일 2배)
- 칩 정산: 시작 칩은 최소 50점(방장이 10점 단위 조절). 라운드마다 남은 타일 수 차이만큼 쌍별 정산.
  칩 소진자가 나오면 매치 종료 → 다시 준비하면 새 매치
- 카지노풍 원형 테이블, 입체 타일, 손패 자동/드래그 정렬, 낼 수 있는 패 구분 표시, 조합 어시스트, 오토패스

### 펠리시티
- 매 라운드 전원이 카드를 뒷면으로 놓아 "자루"를 만들고, 시작 플레이어 카드를 공개 후 경매
- 입찰/패스(패스 시 입찰 코인 회수 + 남은 최저 쥐 카드 코인 획득 + 카드 1장 공개), 최후 1인이 낙찰가를 내고 자루 획득
- 개(큰/작은)가 고양이를 쫓아내는 특수효과, 토끼(0점), 코인은 비공개
- 9라운드 후 모은 고양이 값 + 남은 코인으로 최종 점수 계산

## 구조

```
public/shared/lexio-core.js       렉시오 규칙 엔진(서버·클라 공용)
public/shared/felicity-core.js    펠리시티 규칙 엔진(서버·클라 공용)

server/src/index.js               HTTP + WebSocket 서버
server/src/rooms.js               방/로비/채팅·음성/봇 오케스트레이터(게임 독립)
server/src/games/registry.js      게임 엔진 레지스트리
server/src/games/<id>/            게임별 엔진(index.js) + 상태머신(game.js) + 봇(bot.js)
server/src/store.js               Redis / PostgreSQL 영속화(선택)

public/js/core/                   공용 모듈(net, modal, chat, widgets, shell)
public/js/voice.js                WebRTC 음성채팅(P2P mesh)
public/js/sound.js                효과음(합성 사운드 + 음성 안내)
public/js/games/registry.js       게임 클라이언트 레지스트리
public/js/games/<id>/             게임 클라이언트(index.js) + Canvas 렌더러(ui.js)
```

자세한 설계와 새 게임 추가 방법은 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)에 있습니다.
