"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

function makeElement() {
  const listeners = {};
  const element = {
    children: [],
    listeners,
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
    appendChild(child) {
      this.children.push(child);
    },
  };

  Object.defineProperty(element, "innerHTML", {
    get() {
      return "";
    },
    set() {
      element.children = [];
    },
  });
  return element;
}

test("accepts supported mappers and deletes a ROM with its save", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "apps", "gbemu", "interface.html"),
    "utf8",
  );
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const form = makeElement();
  const input = makeElement();
  const upload = makeElement();
  const status = makeElement();
  const list = makeElement();
  const elements = {
    "rom-form": form,
    "rom-file": input,
    upload,
    status,
    "rom-list": list,
  };
  const erased = [];
  let savedIndex;
  const window = {
    confirm() {
      return true;
    },
  };

  vm.runInNewContext(source, {
    Uint8Array,
    FileReader: function () {
      this.readAsArrayBuffer = function (file) {
        this.result = file.bytes.buffer;
        this.onload();
      };
    },
    window,
    document: {
      getElementById(id) {
        return elements[id];
      },
      createElement() {
        return makeElement();
      },
    },
    Util: {
      readStorageJSON(name, callback) {
        assert.equal(name, "gbemu.roms.json");
        callback([
          {
            title: "Saved Test",
            file: "gbemu.rom.test",
            mapper: "MBC1",
            crc: "test",
          },
        ]);
      },
      eraseStorage(name, callback) {
        erased.push(name);
        callback();
      },
      writeStorage(name, value, callback) {
        assert.equal(name, "gbemu.roms.json");
        savedIndex = JSON.parse(value);
        callback();
      },
    },
  });

  window.onInit();
  const bytes = new Uint8Array(0x150);
  bytes.set(Buffer.from("MBC5 TEST", "ascii"), 0x134);
  bytes[0x147] = 0x1b;
  input.files = [{ bytes }];
  input.listeners.change();
  assert.equal(upload.disabled, false);
  assert.equal(status.textContent, "MBC5 TEST - MBC5");

  bytes[0x147] = 0x10;
  input.files = [{ bytes }];
  input.listeners.change();
  assert.equal(upload.disabled, false);
  assert.equal(status.textContent, "MBC5 TEST - MBC3");

  bytes[0x147] = 0x13;
  input.files = [{ bytes }];
  input.listeners.change();
  assert.equal(upload.disabled, false);
  assert.equal(status.textContent, "MBC5 TEST - MBC3");

  bytes[0x147] = 0x06;
  input.files = [{ bytes }];
  input.listeners.change();
  assert.equal(upload.disabled, false);
  assert.equal(status.textContent, "MBC5 TEST - MBC2");

  assert.equal(list.children.length, 1);
  list.children[0].children[0].listeners.click();

  assert.deepEqual(erased, ["gbemu.rom.test", "gbemu.save.test"]);
  assert.deepEqual(savedIndex, []);
  assert.equal(status.textContent, "Removed Saved Test");
  assert.equal(list.children.length, 0);
});

