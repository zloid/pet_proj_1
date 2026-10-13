"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

test("runs the start, library, game, touch, and exit flow", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "apps", "gbemu", "app.js"),
    "utf8",
  );
  const timers = [];
  const listeners = {};
  const inputs = [];
  const drawCalls = [];
  const writes = {};
  const loadedSaves = [];
  const reads = [];
  const events = {};
  const launchedTitles = [];
  const launchedMappers = [];
  const cycleBudgets = [];
  let ui;
  let created = 0;
  let frameCount = 0;

  const graphics = {
    getWidth: () => 176,
    getHeight: () => 176,
    reset() {
      return this;
    },
    setColor() {
      return this;
    },
    fillRect() {
      return this;
    },
    setFont() {
      return this;
    },
    setFontAlign() {
      return this;
    },
    drawString() {
      return this;
    },
    drawRect() {
      return this;
    },
    drawImage() {
      drawCalls.push("image");
      return this;
    },
  };

  const game = {
    setButtons(buttons) {
      inputs.push(buttons);
    },
    runCycles(cycles) {
      cycleBudgets.push(cycles);
      frameCount += 1;
    },
    getFrame() {
      return { width: 160, height: 144, bpp: 2, buffer: new ArrayBuffer(1) };
    },
    getFrameCount() {
      return frameCount;
    },
    getSaveData() {
      return new Uint8Array([0x47, 0x42]);
    },
    loadSaveData(value) {
      loadedSaves.push(value);
    },
  };

  const core = {
    BUTTON_RIGHT: 0x01,
    BUTTON_LEFT: 0x02,
    BUTTON_UP: 0x04,
    BUTTON_DOWN: 0x08,
    BUTTON_A: 0x10,
    BUTTON_B: 0x20,
    BUTTON_SELECT: 0x40,
    BUTTON_START: 0x80,
    create(rom, metadata) {
      created += 1;
      launchedTitles.push(metadata.title);
      launchedMappers.push(metadata.mapper);
      return game;
    },
    parseHeader(rom) {
      if (rom !== "manual rom") throw new Error("Invalid DMG ROM");
      return { title: "Manual ROM", cartridgeType: 0x01, cgbFlag: 0 };
    },
  };

  vm.runInNewContext(
    source,
    {
      Bangle: {
        setUI(value) {
          ui = value;
        },
        setLCDTimeout() {},
        on(name, callback) {
          listeners[name] = callback;
        },
        removeListener(name) {
          delete listeners[name];
        },
      },
      g: graphics,
      require(name) {
        if (name === "Storage") {
          return {
            readJSON() {
              return [
                {
                  title: "Test ROM",
                  file: "gbemu.rom.test",
                  mapper: "ROM ONLY",
                  crc: "test",
                },
                {
                  title: "Test ROM 2",
                  file: "gbemu.rom.test2",
                  mapper: "ROM ONLY",
                  crc: "test2",
                },
                {
                  title: "Test ROM 3",
                  file: "gbemu.rom.test3",
                  mapper: "ROM ONLY",
                  crc: "test3",
                },
                {
                  title: "Test ROM 4",
                  file: "gbemu.rom.test4",
                  mapper: "ROM ONLY",
                  crc: "test4",
                },
                {
                  title: "Test ROM 5",
                  file: "gbemu.rom.test5",
                  mapper: "ROM ONLY",
                  crc: "test5",
                },
                {
                  title: "Test ROM 6",
                  file: "gbemu.rom.test6",
                  mapper: "ROM ONLY",
                  crc: "test6",
                },
              ];
            },
            list() {
              return [
                "gbemu.rom.test",
                "gbemu.rom.test2",
                "gbemu.rom.test3",
                "gbemu.rom.test4",
                "gbemu.rom.test5",
                "gbemu.rom.test6",
                "manual.gb",
              ];
            },
            read(name, offset, length) {
              reads.push({ name, offset, length });
              if (name === "gbemu.save.test") return "\x99";
              if (name === "manual.gb") return "manual rom";
              return "test rom";
            },
            write(name, value) {
              writes[name] = value;
            },
          };
        }
        if (name === "gbemu.engine") return core;
        throw new Error("Unexpected module " + name);
      },
      setTimeout(callback) {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout() {},
      E: {
        on(name, callback) {
          events[name] = callback;
        },
        toString(bytes) {
          return String.fromCharCode.apply(null, bytes);
        },
      },
      String,
      Math,
    },
    { filename: "app.js" },
  );

  assert.equal(ui.mode, "custom");
  ui.touch(1, { x: 88, y: 80 });
  assert.ok(
    reads.some(
      (read) =>
        read.name === "manual.gb" && read.offset === 0 && read.length === 0x150,
    ),
  );
  ui.touch(1, { x: 20, y: 35 });
  assert.equal(created, 1);
  assert.deepEqual(loadedSaves, ["\x99"]);
  assert.deepEqual(cycleBudgets, []);
  assert.ok(drawCalls.length > 0);
  assert.equal(typeof listeners.drag, "function");

  listeners.drag({ x: 160, y: 140, b: 1 });
  timers[0]();
  assert.deepEqual(cycleBudgets, [256]);
  assert.ok(inputs.includes(core.BUTTON_A));
  assert.ok(drawCalls.length > 1);

  ui.btn();
  assert.equal(listeners.drag, undefined);
  assert.equal(inputs.at(-1), 0);
  assert.equal(writes["gbemu.save.test"], "GB");
  assert.equal(typeof events.kill, "function");

  ui.touch(1, { x: 140, y: 160 });
  ui.touch(1, { x: 20, y: 35 });
  assert.equal(created, 2);
  assert.deepEqual(launchedTitles, ["Test ROM", "Test ROM 6"]);
  ui.btn();

  ui.touch(1, { x: 140, y: 160 });
  ui.touch(1, { x: 20, y: 58 });
  assert.equal(created, 3);
  assert.deepEqual(launchedTitles, ["Test ROM", "Test ROM 6", "Manual ROM"]);
  assert.equal(launchedMappers.at(-1), "MBC1");
  ui.btn();
  assert.equal(
    writes[
      Object.keys(writes).find((name) => name.indexOf("gbemu.save.file.") === 0)
    ],
    "GB",
  );
});

