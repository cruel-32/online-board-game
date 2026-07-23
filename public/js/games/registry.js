/**
 * 클라이언트 게임 플러그인 레지스트리.
 * 각 게임 모듈이 Games.register({ id, name, mount, unmount, setState, ... }) 로 등록한다.
 */
(function () {
  'use strict';

  const clients = {};

  const Games = {
    register(client) {
      clients[client.id] = client;
    },
    get(id) {
      return clients[id] || null;
    },
    has(id) {
      return !!clients[id];
    },
    list() {
      return Object.values(clients).map((c) => ({ id: c.id, name: c.name }));
    },
  };

  window.Games = Games;
})();
