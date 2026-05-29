// @ts-check

bootBasebound();

async function bootBasebound() {
  try {
    const canvas = document.querySelector("#gameCanvas");

    if (!canvas || typeof canvas.getContext !== "function") {
      throw new Error("Basebound could not find the game canvas.");
    }

    const [{ GameScene }, { MainMenu }, { SettingsManager }] = await Promise.all([
      import("./game/GameScene.js?v=1.8.59"),
      import("./game/MainMenu.js?v=1.8.59"),
      import("./game/SettingsManager.js?v=1.8.59")
    ]);

    let activeGame = null;
    let mainMenu = null;

    const publishDebugGame = (game) => {
      try {
        if ("Basebound" in window || Object.isExtensible(window)) {
          window.Basebound = game;
        }
      } catch {
        // Some embedded browser surfaces lock down window. Gameplay uses activeGame.
      }
      try {
        if ("BaseboundGame" in canvas || Object.isExtensible(canvas)) {
          canvas.BaseboundGame = game;
        }
      } catch {
        // Debug exposure is optional; never let it affect match startup.
      }
    };

    const returnToMainMenu = () => {
      activeGame?.multiplayer?.leaveRoom?.();
      activeGame?.destroy?.();
      activeGame = null;
      publishDebugGame(null);
      document.body.dataset.gameStarted = "false";
      document.body.dataset.roomCode = "";
      document.body.dataset.spawnX = "";
      document.body.dataset.spawnY = "";
      mainMenu?.show();
    };

    const settings = new SettingsManager({
      onChange: (keybindings) => {
        activeGame?.refreshKeybindings(keybindings);
      },
      onLeaveGame: returnToMainMenu
    });

    mainMenu = new MainMenu({
      settingsManager: settings,
      onStart: (session) => {
        activeGame?.destroy?.();
        const game = new GameScene(canvas, {
          keybindings: session.keybindings,
          multiplayer: session.roomClient || null,
          playerName: session.displayName,
          aiCount: session.aiCount || 0,
          mapSize: session.mapSize || "large",
          characterId: session.characterId || "ranger",
          aiClassAssignments: session.aiClassAssignments || [],
          worldOptions: session.worldOptions || {},
          worldSeed: session.worldSeed || session.room?.settings?.worldSeed || null,
          isHost: Boolean(session.isHost),
          roomCode: session.room?.code || null,
          startAt: session.startAt || 0,
          onLeaveMatch: returnToMainMenu
        });
        activeGame = game;
        publishDebugGame(game);
        document.body.dataset.gameStarted = "true";
        document.body.dataset.roomCode = session.room?.code || "solo";
        game.start();
        game.resize?.();
        requestAnimationFrame(() => game.resize?.());
        window.setTimeout(() => game.resize?.(), 80);
      }
    });

    if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  } catch (error) {
    console.error(error);
    document.body.dataset.bootError = error instanceof Error ? error.message : String(error);
    const healthText = document.querySelector("#healthText");
    if (healthText) {
      healthText.textContent = "Boot error";
    }
  }
}











