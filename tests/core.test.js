"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../apps/gbemu/gbemu.engine.js");

function makeRom(options = {}) {
  const bytes = Buffer.alloc(options.length || 0x8000);
  const title = options.title || "DMG TEST";
  bytes.write(title, 0x134, "ascii");
  bytes[0x143] = options.cgbFlag || 0;
  bytes[0x147] = options.cartridgeType || 0;
  bytes[0x148] = 0;
  bytes[0x149] = options.ramSizeCode || 0;
  return bytes.toString("latin1");
}

test("parses a valid ROM ONLY header", () => {
  const header = Core.parseHeader(makeRom({ title: "HOME TEST" }));

  assert.equal(header.title, "HOME TEST");
  assert.equal(header.cartridgeType, Core.ROM_ONLY);
});

test("creates the documented post-boot register state", () => {
  const core = Core.create(makeRom());
  const registers = core.getRegisters();

  assert.deepEqual(registers, {
    a: 0x01,
    f: 0xb0,
    b: 0x00,
    c: 0x13,
    d: 0x00,
    e: 0xd8,
    h: 0x01,
    l: 0x4d,
    sp: 0xfffe,
    pc: 0x0100,
  });
});

test("maps work RAM and its echo", () => {
  const core = Core.create(makeRom());

  core.writeByte(0xc123, 0x5a);
  assert.equal(core.readByte(0xe123), 0x5a);
  core.writeByte(0xefee, 0xa5);
  assert.equal(core.readByte(0xcfee), 0xa5);
});

test("executes the first load/store opcode slice", () => {
  const rom = makeRom();
  const bytes = Buffer.from(rom, "latin1");
  bytes.set([0x3e, 0x42, 0xea, 0x00, 0xc0, 0xfa, 0x00, 0xc0, 0x76], 0x100);
  const core = Core.create(bytes.toString("latin1"));

  assert.equal(core.step(), 8);
  assert.equal(core.getRegisters().a, 0x42);
  assert.equal(core.step(), 16);
  assert.equal(core.readByte(0xc000), 0x42);
  assert.equal(core.step(), 16);
  assert.equal(core.getRegisters().a, 0x42);
  assert.equal(core.step(), 4);
  assert.equal(core.isHalted(), true);
});

test("executes CB instructions and stack transfers", () => {
  const rom = makeRom();
  const bytes = Buffer.from(rom, "latin1");
  bytes.set([0x06, 0x0f, 0xcb, 0x30, 0xc5, 0xd1, 0x76], 0x100);
  const core = Core.create(bytes.toString("latin1"));

  while (!core.isHalted()) core.step();

  assert.equal(core.getRegisters().b, 0xf0);
  assert.equal(core.getRegisters().d, 0xf0);
  assert.equal(core.getRegisters().e, 0x13);
});

test("switches MBC1 ROM banks", () => {
  const bytes = Buffer.alloc(0x10000);
  let bank;

  for (bank = 0; bank < 4; bank += 1) bytes[bank * 0x4000] = bank;
  bytes.write("MBC1 TEST", 0x134, "ascii");
  bytes[0x147] = 0x01;
  const core = Core.create(bytes.toString("latin1"));

  assert.equal(core.readByte(0x4000), 1);
  core.writeByte(0x2000, 0x02);
  assert.equal(core.readByte(0x4000), 2);
  core.writeByte(0x2000, 0x03);
  assert.equal(core.readByte(0x4000), 3);
});

test("switches MBC2 ROM bank and mirrors its 4-bit RAM", () => {
  const bytes = Buffer.alloc(0x10000);

  bytes.write("MBC2 TEST", 0x134, "ascii");
  bytes[0x147] = 0x06;
  bytes[2 * 0x4000] = 0x2c;
  const core = Core.create(bytes.toString("latin1"));

  core.writeByte(0x2100, 0x02);
  assert.equal(core.readByte(0x4000), 0x2c);

  core.writeByte(0x0000, 0x0a);
  core.writeByte(0xa000, 0xab);
  assert.equal(core.readByte(0xa000), 0xfb);
  core.writeByte(0xa200, 0x07);
  assert.equal(core.readByte(0xa000), 0xf7);
  core.writeByte(0x0000, 0x00);
  assert.equal(core.readByte(0xa000), 0xff);
});

test("switches MBC5 high ROM and RAM banks while ignoring rumble", () => {
  const highBank = 0x100;
  const bytes = Buffer.alloc((highBank + 1) * 0x4000);

  bytes.write("MBC5 TEST", 0x134, "ascii");
  bytes[0x147] = 0x1e;
  bytes[0x149] = 0x03;
  bytes[highBank * 0x4000] = 0x5a;
  const core = Core.create(bytes.toString("latin1"));

  core.writeByte(0x2000, 0x00);
  core.writeByte(0x3000, 0x01);
  assert.equal(core.readByte(0x4000), 0x5a);

  core.writeByte(0x0000, 0x0a);
  core.writeByte(0x4000, 0x01);
  core.writeByte(0xa000, 0x11);
  core.writeByte(0x4000, 0x02);
  assert.equal(core.readByte(0xa000), 0x00);
  core.writeByte(0x4000, 0x01);
  assert.equal(core.readByte(0xa000), 0x11);
  core.writeByte(0x4000, 0x09);
  assert.equal(core.readByte(0xa000), 0x11);
});

test("switches MBC3 ROM and RAM banks without RTC", () => {
  const bytes = Buffer.alloc(0x10000);

  bytes.write("MBC3 TEST", 0x134, "ascii");
  bytes[0x147] = 0x13;
  bytes[0x149] = 0x03;
  bytes[2 * 0x4000] = 0x3c;
  const core = Core.create(bytes.toString("latin1"));

  core.writeByte(0x2000, 0x02);
  assert.equal(core.readByte(0x4000), 0x3c);

  core.writeByte(0x0000, 0x0a);
  core.writeByte(0x4000, 0x01);
  core.writeByte(0xa000, 0x66);
  core.writeByte(0x4000, 0x02);
  assert.equal(core.readByte(0xa000), 0x00);
  core.writeByte(0x4000, 0x01);
  assert.equal(core.readByte(0xa000), 0x66);
  core.writeByte(0x4000, 0x08);
  assert.equal(core.readByte(0xa000), 0xff);
});

test("latches and persists MBC3 RTC state", () => {
  let now = 1_000_000;
  const rom = makeRom({ cartridgeType: 0x10, ramSizeCode: 0x02 });
  const source = Core.create(rom, undefined, () => now);

  source.writeByte(0x0000, 0x0a);
  source.writeByte(0xa000, 0x5a);
  source.writeByte(0x4000, 0x08);
  source.writeByte(0xa000, 58);
  now += 3_000;
  source.writeByte(0x6000, 0x00);
  source.writeByte(0x6000, 0x01);
  assert.equal(source.readByte(0xa000), 1);

  const saved = source.getSaveData();
  now += 2_000;
  const restored = Core.create(rom, undefined, () => now);
  restored.loadSaveData(saved);
  restored.writeByte(0x0000, 0x0a);
  restored.writeByte(0x4000, 0x08);
  restored.writeByte(0x6000, 0x00);
  restored.writeByte(0x6000, 0x01);

  assert.equal(restored.readByte(0xa000), 3);
  restored.writeByte(0x4000, 0x00);
  assert.equal(restored.readByte(0xa000), 0x5a);
  restored.writeByte(0x4000, 0x0c);
  restored.writeByte(0xa000, 0x40);
  now += 5_000;
  restored.writeByte(0x6000, 0x00);
  restored.writeByte(0x6000, 0x01);
  restored.writeByte(0x4000, 0x08);
  assert.equal(restored.readByte(0xa000), 3);
});

test("restores MBC1 cartridge RAM into a new core", () => {
  const rom = makeRom({ cartridgeType: 0x03, ramSizeCode: 0x02 });
  const source = Core.create(rom);
  let saved;
  const restored = Core.create(rom);

  source.writeByte(0x0000, 0x0a);
  source.writeByte(0xa123, 0x5a);
  saved = new Uint8Array(source.getSaveRam());
  restored.loadSaveRam(saved);
  restored.writeByte(0x0000, 0x0a);

  assert.equal(restored.readByte(0xa123), 0x5a);
});

test("advances timer and renders a DMG tile row", () => {
  const core = Core.create(makeRom());

  core.writeByte(0xff07, 0x05);
  core.runCycles(16);
  assert.equal(core.readByte(0xff05), 1);

  core.writeByte(0xff47, 0xe4);
  core.writeByte(0x8000, 0x80);
  core.writeByte(0x8001, 0x00);
  core.writeByte(0x9800, 0x00);
  core.runCycles(456);
  assert.equal(core.getFrameBuffer()[0] & 0xc0, 0x40);
});

