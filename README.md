# 렉시오 온라인 (LEXIO Online)

보드게임 **렉시오(LEXIO)** 를 원작 룰 그대로 구현한 온라인 멀티플레이 게임입니다.
스마트폰 **가로 모드** 기준으로 설계되었으며, 아이폰 SE 화면에서도 UI가 잘리지 않습니다.

## 실행 방법

### Docker (홈서버 배포)

```bash
docker compose up --build -d
# http://<서버주소>:8082 접속
```

앱(Node.js) + Redis + PostgreSQL이 함께 기동됩니다.
라운드 결과는 PostgreSQL(`round_results` 테이블)에 기록되고 Redis에 최근 결과가 캐시됩니다.

### 로컬 개발

```bash
npm install
npm run dev        # http://localhost:8080
npm test           # 봇 자동 대전 시뮬레이션(룰 검증)
```

Redis/PostgreSQL 없이도 동작합니다. (`REDIS_URL`, `DATABASE_URL` 환경변수 설정 시 사용)

## 기능

- **대기룸**: 방 생성(비밀번호 선택), 초대 링크 복사, 방장 권한(최대 인원 3~5명 조절, 강퇴, 봇 추가/제거)
- **봇 플레이**: 인원이 부족하면 봇으로 채워 3~5인 플레이 가능. 게임 중 이탈/접속 끊김 시 봇이 대신 진행
- **원작 룰**: 인원별 타일 범위(3인 1~9 / 4인 1~13 / 5인 1~15), 구름③ 선, 1·2·3·5개 제출,
  스트레이트<플러쉬<풀하우스<포카드<스트레이트플러쉬, 특수 스트레이트 서열, '1'의 특수기능, '2' 검사(남은 타일 2배)
- **칩 정산**: 시작 칩은 인당 동일하게 최소 50점이며 방장이 대기실에서 50점 단위로 조절 가능.
  라운드마다 남은 타일 수 차이만큼 쌍별 정산. 칩이 소진된 사람이 나오면 매치 종료 → 방에서 다시 준비하면 새 매치 시작
- **게임 UI**: 카지노풍 원형 테이블, 입체(3D) 타일, 선/차례 표시, 마지막 낸 패와 낸 사람 표시,
  손패 오름차순 자동 정렬 + 드래그 수동 정렬(액티브 효과), 낼 수 있는 패/없는 패 구분 표시
- **어시스트**: 버튼을 누르면 내 손패로 만들 수 있는 모든 조합을 팝업으로 표시, 누르면 자동 선택

## 구조

```
public/shared/lexio-core.js   룰 엔진 (서버·클라이언트 공용)
server/src/index.js           HTTP + WebSocket 서버
server/src/rooms.js           방/접속/메시지 라우팅
server/src/game.js            라운드 상태 머신
server/src/bot.js             봇 AI
server/src/store.js           Redis / PostgreSQL 영속화 (선택)
public/js/app.js              로비·대기실·HUD·팝업
public/js/game-ui.js          Canvas 게임 렌더러 + 터치 입력
```
