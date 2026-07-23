/**
 * 게임 독립 모달 팝업 유틸.
 * - .popup-close[data-close] 버튼과 .popup.dismissable 배경 클릭으로 닫기를 자동 배선.
 * - 게임 모듈이 동적으로 주입한 팝업도 open/close 로 제어.
 */
(function () {
  'use strict';

  const Modal = {
    init() {
      document.addEventListener('click', (e) => {
        // 닫기 버튼
        const closeBtn = e.target.closest && e.target.closest('.popup-close');
        if (closeBtn && closeBtn.dataset.close) {
          this.close(closeBtn.dataset.close);
          return;
        }
        // dismissable 팝업의 배경(팝업 바깥 어두운 영역) 클릭
        if (e.target.classList && e.target.classList.contains('popup') && e.target.classList.contains('dismissable')) {
          this.close(e.target.id);
        }
      });
    },
    open(id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    },
    close(id) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    },
    isOpen(id) {
      const el = document.getElementById(id);
      return !!el && !el.classList.contains('hidden');
    },
  };

  window.Modal = Modal;
})();
