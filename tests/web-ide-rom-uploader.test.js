"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

function makeRom() {
  const bytes = new Uint8Array(0x8000);
  const title = "UPLOADER TEST";

  for (let index = 0; index < title.length; index += 1) {
    bytes[0x134 + index] = title.charCodeAt(index);
  }
  bytes[0x147] = 0x00;
  return bytes;
}

function loadUploader(context) {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "tools", "gbemu-rom-uploader.html"),
    "utf8",
  );
  const match = html.match(/<script>([\s\S]*?)<\/script>/);

  assert.ok(match, "uploader contains an inline script");
  vm.runInNewContext(match[1], context);
}

function makeElement() {
  const listeners = {};

  return {
    disabled: false,
    value: "",
    files: [],
    className: "",
    textContent: "",
    addEventListener(name, listener) {
      listeners[name] = listener;
    },
    fire(name) {
      listeners[name]();
    },
    focus() {},
    select() {},
  };
}

test("builds and executes a chunked post-install ROM import script", () => {
  const fileInput = makeElement();
  const buildButton = makeElement();
  const copyButton = makeElement();
  const status = makeElement();
  const output = makeElement();
  const elements = {
    "rom-file": fileInput,
    build: buildButton,
    copy: copyButton,
    status,
    script: output,
  };
  const rom = makeRom();
  const uploads = {};
  const writeCalls = [];
  let loaded;

  class FileReaderMock {
    readAsArrayBuffer(file) {
      this.result = file.bytes.buffer.slice(0);
      this.onload();
    }
  }

  loadUploader({
    Uint8Array,
    FileReader: FileReaderMock,
    document: {
      getElementById(id) {
        return elements[id];
      },
      execCommand() {},
    },
    navigator: {},
    btoa(value) {
      return Buffer.from(value, "latin1").toString("base64");
    },
  });

  fileInput.files = [{ bytes: rom }];
  fileInput.fire("change");
  assert.equal(buildButton.disabled, false);
  buildButton.fire("click");

  assert.equal(copyButton.disabled, false);
  assert.match(output.value, /Storage\.write\("gbemu\.rom\./);

  const storage = {
    readJSON(name) {
      assert.equal(name, "gbemu.roms.json");
      return [];
    },
    write(name, value, offset, size) {
      const writeOffset = offset || 0;
      const existing = uploads[name] || "";

      writeCalls.push({ name, value, offset: writeOffset, size });
      if (typeof offset !== "number") {
        uploads[name] = value;
      } else if (writeOffset === 0) {
        uploads[name] = value + "\xff".repeat(Math.max(0, size - value.length));
      } else {
        uploads[name] =
          existing.slice(0, writeOffset) +
          value +
          existing.slice(writeOffset + value.length);
      }
    },
  };

  vm.runInNewContext(output.value, {
    Array,
    JSON,
    require(name) {
      assert.equal(name, "Storage");
      return storage;
    },
    atob(value) {
      return Buffer.from(value, "base64").toString("latin1");
    },
    load(name) {
      loaded = name;
    },
    print() {},
  });

  const library = JSON.parse(uploads["gbemu.roms.json"]);
  const entry = library[0];
  const romWrites = writeCalls.filter((call) => call.name === entry.file);

  assert.equal(loaded, "gbemu.app.js");
  assert.deepEqual(library, [
    {
      title: "UPLOADER TEST",
      file: entry.file,
      mapper: "ROM ONLY",
      crc: entry.crc,
      size: rom.length,
    },
  ]);
  assert.equal(uploads[entry.file], Buffer.from(rom).toString("latin1"));
  assert.equal(romWrites[0].size, rom.length);
  assert.ok(romWrites.every((call) => call.value.length <= 384));
});
