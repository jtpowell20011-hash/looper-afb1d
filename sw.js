"use strict";

const CACHE_NAME = "basebound-v1.8.53";
const APP_SHELL = [
  "/",
  "/index.html",
  "/assets/vendor/three.r128.min.js?v=1.8.53",
  "/styles.css?v=1.8.53",
  "/src/main.js?v=1.8.53",
  "/src/game/AIPlayer.js?v=1.8.53",
  "/src/game/Ability.js?v=1.8.53",
  "/src/game/Base.js?v=1.8.53",
  "/src/game/CharacterClasses.js?v=1.8.53",
  "/src/game/config.js?v=1.8.53",
  "/src/game/Entity.js?v=1.8.53",
  "/src/game/FutureMultiplayerInterfaces.js?v=1.8.53",
  "/src/game/GameScene.js?v=1.8.53",
  "/src/game/InputBindings.js?v=1.8.53",
  "/src/game/LowPolyRenderer.js?v=1.8.53",
  "/src/game/MainMenu.js?v=1.8.53",
  "/src/game/Map.js?v=1.8.53",
  "/src/game/MatchManager.js?v=1.8.53",
  "/src/game/math.js?v=1.8.53",
  "/src/game/MultiplayerRoomClient.js?v=1.8.53",
  "/src/game/Mob.js?v=1.8.53",
  "/src/game/Objective.js?v=1.8.53",
  "/src/game/Player.js?v=1.8.53",
  "/src/game/RewardSystem.js?v=1.8.53",
  "/src/game/SettingsManager.js?v=1.8.53",
  "/src/game/UIManager.js?v=1.8.53",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});












