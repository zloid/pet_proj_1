(function () {
  var Storage = require("Storage");
  var Core = require("gbemu.engine");
  var INDEX_FILE = "gbemu.roms.json";
  var ROM_FILE_PREFIX = "gbemu.rom.";
  var screen = { mode: "start", games: [] };
  var gameCore;
  var gameButtons = 0;
  var gameTimer;
  var tapRelease;
  var gameSaveFile;
  var gameTicks = 0;
  var lastFrameCount = -1;
  var lastDrawnButtons = -1;
  var CYCLES_PER_TICK = 256;
  var TICK_INTERVAL_MS = 1;
  var LIBRARY_PAGE_SIZE = 5;

  function mapperName(cartridgeType) {
    if (
      cartridgeType === 0x00 ||
      cartridgeType === 0x08 ||
      cartridgeType === 0x09
    ) {
      return "ROM ONLY";
    }
    if (
      cartridgeType === 0x01 ||
      cartridgeType === 0x02 ||
      cartridgeType === 0x03
    ) {
      return "MBC1";
    }
    if (cartridgeType === 0x05 || cartridgeType === 0x06) return "MBC2";
    if (cartridgeType >= 0x0f && cartridgeType <= 0x13) return "MBC3";
    if (cartridgeType >= 0x19 && cartridgeType <= 0x1e) return "MBC5";
    return undefined;
  }

  function isRomFile(filename) {
    if (typeof filename !== "string") return false;
    var lower = filename.toLowerCase();
    return (
      filename.indexOf(ROM_FILE_PREFIX) === 0 ||
      lower.substr(-3) === ".gb" ||
      lower.substr(-4) === ".bin"
    );
  }

  function gameFromFile(filename) {
    var rom = Storage.read(filename, 0, 0x150);
    var header;
    var mapper;

    if (!rom) return undefined;
    try {
      header = Core.parseHeader(rom);
      mapper = mapperName(header.cartridgeType);
    } catch (error) {
      return undefined;
    }
    if (!mapper || (header.cgbFlag !== 0 && header.cgbFlag !== 0x80))
      return undefined;
    return {
      title: header.title || filename,
      file: filename,
      mapper: mapper,
    };
  }

  function hasGame(games, filename) {
    var index;
    for (index = 0; index < games.length; index += 1) {
      if (games[index].file === filename) return true;
    }
    return false;
  }

  function appendGame(games, game) {
    if (!game || typeof game.file !== "string" || hasGame(games, game.file))
      return;
    games.push(game);
  }

  function getGames() {
    var indexed = Storage.readJSON(INDEX_FILE, 1);
    var games = [];
    var files;
    var filename;
    var index;

    if (!Array.isArray(indexed)) indexed = [];
    if (typeof Storage.list !== "function") return indexed;
    try {
      files = Storage.list();
    } catch (error) {
      return indexed;
    }
    if (!Array.isArray(files)) return indexed;

    for (index = 0; index < indexed.length; index += 1) {
      if (indexed[index] && files.indexOf(indexed[index].file) >= 0) {
        appendGame(games, indexed[index]);
      }
    }
    for (index = 0; index < files.length; index += 1) {
      filename = files[index];
      if (isRomFile(filename) && !hasGame(games, filename)) {
        appendGame(games, gameFromFile(filename));
      }
    }
    return games;
  }

  function drawHeader(title) {
    g.reset();
    g.setColor(0x0000).fillRect(0, 0, g.getWidth() - 1, g.getHeight() - 1);
    g.setColor(0xafe5).fillRect(0, 0, g.getWidth() - 1, 25);
    g.setColor(0x0000).setFont("6x8", 2).setFontAlign(0, 0);
    g.drawString(title, g.getWidth() / 2, 13);
  }

  function showStart() {
    screen.mode = "start";
    drawHeader("GAME BOY DMG");
    g.setColor(0xffff).setFont("6x8", 2).setFontAlign(0, 0);
    g.drawString("EMULATOR", 88, 57);
    g.setColor(0x7bef).setFont("6x8", 1);
    g.drawString("Tap to open ROM library", 88, 86);
    g.setColor(0x03e0).fillRect(28, 117, 147, 145);
    g.setColor(0x0000).setFont("6x8", 2);
    g.drawString("ROM LIBRARY", 88, 131);
  }

  function showLibrary(page) {
    var games = getGames();
    var maxPage = Math.max(0, Math.ceil(games.length / LIBRARY_PAGE_SIZE) - 1);
    var start;
    screen.mode = "library";
    screen.games = games;
    screen.page = Math.max(0, Math.min(page || 0, maxPage));
    drawHeader("ROM LIBRARY");

    if (!games.length) {
      g.setColor(0xffff).setFont("6x8", 1).setFontAlign(0, 0);
      g.drawString("No ROMs installed", 88, 72);
      g.setColor(0x7bef);
      g.drawString("Upload .gb/.bin to Storage", 88, 92);
      return;
    }

    g.setFont("6x8", 1).setFontAlign(-1, 0);
    start = screen.page * LIBRARY_PAGE_SIZE;
    games
      .slice(start, start + LIBRARY_PAGE_SIZE)
      .forEach(function (game, index) {
        var top = 31 + index * 23;
        g.setColor(index % 2 ? 0x18c3 : 0x0841).fillRect(8, top, 167, top + 19);
        g.setColor(0xffff).drawString(
          game.title || "Untitled ROM",
          14,
          top + 10,
        );
        g.setColor(0xafe5)
          .setFontAlign(1, 0)
          .drawString(game.mapper || "ROM", 160, top + 10);
        g.setFontAlign(-1, 0);
      });

    if (maxPage > 0) {
      drawKey(8, 151, 73, 173, "PREV", 0);
      drawKey(103, 151, 168, 173, "NEXT", 0);
      g.setColor(0xffff).setFont("6x8", 1).setFontAlign(0, 0);
      g.drawString(screen.page + 1 + "/" + (maxPage + 1), 88, 162);
    }
  }

  function showError(message) {
    screen.mode = "error";
    drawHeader("ROM ERROR");
    g.setColor(0xffff).setFont("6x8", 1).setFontAlign(0, 0);
    g.drawString(String(message).substr(0, 28), 88, 70);
    g.setColor(0x7bef).drawString("Tap to return", 88, 100);
  }

  function keyIsDown(mask) {
    return (gameButtons & mask) !== 0;
  }

  function saveFileForGame(game) {
    var identifier = game && game.crc;
    var index;
    if (!identifier && game && typeof game.file === "string") {
      if (game.file.indexOf("gbemu.rom.") === 0)
        identifier = game.file.substr(10);
      else {
        identifier = 5381;
        for (index = 0; index < game.file.length; index += 1) {
          identifier = ((identifier * 33) ^ game.file.charCodeAt(index)) >>> 0;
        }
        identifier = "file." + identifier.toString(16);
      }
    }
    return identifier ? "gbemu.save." + identifier : undefined;
  }

  function saveGameRam() {
    var data;
    if (!gameCore || !gameSaveFile) return;
    data = gameCore.getSaveData
      ? gameCore.getSaveData()
      : gameCore.getSaveRam();
    if (data && data.length) Storage.write(gameSaveFile, E.toString(data));
  }

  function drawKey(x1, y1, x2, y2, label, mask) {
    g.setColor(keyIsDown(mask) ? 0xafe5 : 0x18c3).fillRect(x1, y1, x2, y2);
    g.setColor(0xffff).drawRect(x1, y1, x2, y2);
    g.setColor(0x0000).setFont("6x8", 1).setFontAlign(0, 0);
    g.drawString(label, (x1 + x2) / 2, (y1 + y2) / 2);
  }

  function drawGameKeys() {
    lastDrawnButtons = gameButtons;
    drawKey(20, 112, 37, 130, "U", Core.BUTTON_UP);
    drawKey(1, 133, 19, 151, "L", Core.BUTTON_LEFT);
    drawKey(39, 133, 57, 151, "R", Core.BUTTON_RIGHT);
    drawKey(20, 154, 37, 172, "D", Core.BUTTON_DOWN);
    drawKey(60, 145, 87, 169, "SEL", Core.BUTTON_SELECT);
    drawKey(90, 145, 117, 169, "ST", Core.BUTTON_START);
    drawKey(121, 130, 147, 157, "B", Core.BUTTON_B);
    drawKey(150, 130, 175, 157, "A", Core.BUTTON_A);
  }

  function drawGameFrame() {
    g.drawImage(gameCore.getFrame(), 28, 1, { scale: 0.75 });
    g.setColor(0xafe5).drawRect(27, 0, 148, 109);
  }

  function drawGame() {
    g.reset();
    g.setColor(0x0000).fillRect(0, 0, 175, 175);
    drawGameFrame();
    drawGameKeys();
  }

  function controlAt(x, y) {
    var buttons = 0;
    var dx;
    var dy;

    if (y < 110) return 0;
    if (x < 59) {
      dx = x - 29;
      dy = y - 142;
      if (Math.abs(dx) > 7)
        buttons |= dx < 0 ? Core.BUTTON_LEFT : Core.BUTTON_RIGHT;
      if (Math.abs(dy) > 7)
        buttons |= dy < 0 ? Core.BUTTON_UP : Core.BUTTON_DOWN;
      return buttons;
    }
    if (x < 119) return x < 89 ? Core.BUTTON_SELECT : Core.BUTTON_START;
    return x < 149 ? Core.BUTTON_B : Core.BUTTON_A;
  }

  function onGameDrag(event) {
    if (!gameCore) return;
    gameButtons = event && event.b ? controlAt(event.x, event.y) : 0;
  }

  function stopGame() {
    if (gameTimer) clearTimeout(gameTimer);
    if (tapRelease) clearTimeout(tapRelease);
    saveGameRam();
    gameTimer = undefined;
    tapRelease = undefined;
    gameButtons = 0;
    if (gameCore) gameCore.setButtons(0);
    gameCore = undefined;
    gameSaveFile = undefined;
    gameTicks = 0;
    lastFrameCount = -1;
    lastDrawnButtons = -1;
    if (Bangle.removeListener) Bangle.removeListener("drag", onGameDrag);
    Bangle.setLCDTimeout(10);
  }

  function currentFrameCount() {
    return gameCore.getFrameCount ? gameCore.getFrameCount() : lastFrameCount;
  }

  function gameTick() {
    var frameCount;
    if (!gameCore) return;
    try {
      gameCore.setButtons(gameButtons);
      gameCore.runCycles(CYCLES_PER_TICK);
      gameTicks += 1;
      frameCount = currentFrameCount();
      if (frameCount !== lastFrameCount) {
        lastFrameCount = frameCount;
        drawGameFrame();
      }
      if (lastDrawnButtons !== gameButtons) drawGameKeys();
      if (gameTicks % 1000 === 0) saveGameRam();
      gameTimer = setTimeout(gameTick, TICK_INTERVAL_MS);
    } catch (error) {
      stopGame();
      showError(error.message || "Emulation stopped");
    }
  }

  function startGame(core, saveFile) {
    gameCore = core;
    gameButtons = 0;
    gameSaveFile = saveFile;
    gameTicks = 0;
    lastFrameCount = currentFrameCount();
    lastDrawnButtons = -1;
    screen.mode = "game";
    Bangle.setLCDTimeout(0);
    Bangle.on("drag", onGameDrag);
    drawGame();
    gameTimer = setTimeout(gameTick, TICK_INTERVAL_MS);
  }

  function launchGame(game) {
    var rom = Storage.read(game.file);
    var core;
    var saveFile;
    if (!rom) {
      showError("ROM file is missing");
      return;
    }

    try {
      core = Core.create(rom, game);
      saveFile = saveFileForGame(game);
      if (saveFile) {
        if (core.loadSaveData) core.loadSaveData(Storage.read(saveFile));
        else core.loadSaveRam(Storage.read(saveFile));
      }
      startGame(core, saveFile);
    } catch (error) {
      showError(error.message || "Cannot open ROM");
    }
  }

  function onTouch(zone, event) {
    var y = event && event.y;
    if (screen.mode === "game" && event) {
      gameButtons = controlAt(event.x, event.y);
      if (tapRelease) clearTimeout(tapRelease);
      tapRelease = setTimeout(function () {
        gameButtons = 0;
        tapRelease = undefined;
      }, 100);
      return;
    }
    if (screen.mode === "start") {
      showLibrary();
      return;
    }
    if (screen.mode === "error") {
      showLibrary();
      return;
    }
    if (screen.mode === "library" && typeof y === "number") {
      var index = Math.floor((y - 31) / 23);
      var gameIndex = screen.page * LIBRARY_PAGE_SIZE + index;
      var maxPage = Math.max(
        0,
        Math.ceil(screen.games.length / LIBRARY_PAGE_SIZE) - 1,
      );
      if (y >= 151 && screen.games.length > LIBRARY_PAGE_SIZE) {
        if (event.x < 88 && screen.page > 0) showLibrary(screen.page - 1);
        else if (event.x >= 88 && screen.page < maxPage)
          showLibrary(screen.page + 1);
      } else if (
        index >= 0 &&
        index < LIBRARY_PAGE_SIZE &&
        gameIndex < screen.games.length
      ) {
        launchGame(screen.games[gameIndex]);
      }
    }
  }

  function onButton() {
    if (gameCore) {
      stopGame();
      showLibrary();
    } else {
      showStart();
    }
  }

  Bangle.setUI({
    mode: "custom",
    touch: onTouch,
    btn: onButton,
  });
  E.on("kill", stopGame);
  showStart();
})();

