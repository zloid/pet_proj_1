"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const {
  buildInstaller,
  createRomEntry,
} = require("../scripts/build-web-ide-installer.js");

function makeRom() {
  const bytes = Buffer.alloc(0x8000);
  bytes.write("WEB IDE TEST", 0x134, "ascii");
  bytes[0x147] = 0x00;
  return bytes;
}

test("generates a Web IDE installer with an optional ROM library entry", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "gbemu-web-ide-"),
  );
  const romPath = path.join(temporaryDirectory, "test.gb");
  const rom = makeRom();
  const writes = {};
  const writeCalls = [];
  let loaded;

  fs.writeFileSync(romPath, rom);

  try {
    vm.runInNewContext(buildInstaller({ romPath }), {
      require(name) {
        assert.equal(name, "Storage");
        return {
          readJSON(name) {
            assert.equal(name, "gbemu.roms.json");
            return [];
          },
          write(name, value, offset, size) {
            const writeOffset = offset || 0;
            const existing = writes[name] || "";

            writeCalls.push({ name, value, offset: writeOffset, size });
            if (writeOffset === 0) {
              writes[name] =
                value +
                "\xff".repeat(
                  Math.max(0, (size || value.length) - value.length),
                );
            } else {
              writes[name] =
                existing.slice(0, writeOffset) +
                value +
                existing.slice(writeOffset + value.length);
            }
          },
        };
      },
      atob(value) {
        return Buffer.from(value, "base64").toString("latin1");
      },
      load(name) {
        loaded = name;
      },
      print() {},
    });
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  const entry = createRomEntry(rom);
  const info = JSON.parse(writes["gbemu.info"]);

  assert.equal(loaded, "gbemu.app.js");
  assert.equal(
    writes["gbemu.engine"],
    fs.readFileSync(
      path.join(__dirname, "..", "apps", "gbemu", "gbemu.engine.js"),
      "utf8",
    ),
  );
  assert.equal(
    writes["gbemu.app.js"],
    fs.readFileSync(
      path.join(__dirname, "..", "apps", "gbemu", "app.js"),
      "utf8",
    ),
  );
  assert.equal(info.src, "gbemu.app.js");
  assert.equal(info.icon, "gbemu.img");
  assert.equal(writes[entry.file], rom.toString("latin1"));
  assert.deepEqual(JSON.parse(writes["gbemu.roms.json"]), [entry]);
  assert.ok(
    writeCalls
      .filter(
        (call) => call.name === "gbemu.engine" || call.name === "gbemu.app.js",
      )
      .every((call) => call.value.length <= 512),
  );
  assert.ok(
    writeCalls
      .filter((call) => call.name === entry.file)
      .every((call) => call.value.length <= 384),
  );
});
