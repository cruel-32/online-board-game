/**
 * 플랫폼 판별(게임 독립 공용 유틸).
 * 키보드 입력이 가능한 환경인지(≈ PC)를 판별한다 — 터치 전용 모바일 기기에서는
 * 키 바인딩 설정처럼 키보드 전제 UI를 굳이 노출할 필요가 없다.
 */
(function () {
  'use strict';

  function isKeyboardPlatform() {
    const ua = (navigator.userAgent || '').toLowerCase();
    const mobileRe = /android|iphone|ipad|ipod|windows phone|mobile/;
    return !mobileRe.test(ua);
  }

  window.Platform = { isKeyboardPlatform };
})();
