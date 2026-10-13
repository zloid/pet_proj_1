(function () {
  var FLAG_Z = 0x80;
  var FLAG_N = 0x40;
  var FLAG_H = 0x20;
  var FLAG_C = 0x10;
  var ROM_ONLY = 0x00;
  var BUTTON_RIGHT = 0x01;
  var BUTTON_LEFT = 0x02;
  var BUTTON_UP = 0x04;
  var BUTTON_DOWN = 0x08;
  var BUTTON_A = 0x10;
  var BUTTON_B = 0x20;
  var BUTTON_SELECT = 0x40;
  var BUTTON_START = 0x80;

  function byte(value) {
    return value & 255;
  }

  function word(value) {
    return value & 65535;
  }

  function signedByte(value) {
    return value & 128 ? value - 256 : value;
  }

  function romByte(rom, offset) {
    if (offset < 0 || offset >= rom.length) return 255;
    return rom.charCodeAt(offset) & 255;
  }

  function readTitle(rom) {
    var title = "";
    var index;
    for (index = 0x134; index < 0x144; index += 1) {
      var value = romByte(rom, index);
      if (!value) break;
      title += String.fromCharCode(value);
    }
    return title || "Untitled ROM";
  }

  function parseHeader(rom) {
    if (typeof rom !== "string" || rom.length < 0x150) {
      throw new Error("Invalid DMG ROM");
    }

    return {
      title: readTitle(rom),
      cartridgeType: romByte(rom, 0x147),
      romSizeCode: romByte(rom, 0x148),
      ramSizeCode: romByte(rom, 0x149),
      cgbFlag: romByte(rom, 0x143),
    };
  }

  function ramLength(code) {
    if (code === 1) return 0x0800;
    if (code === 2) return 0x2000;
    if (code === 3) return 0x8000;
    if (code === 4) return 0x20000;
    if (code === 5) return 0x10000;
    return 0;
  }

  function mapperFor(cartridgeType) {
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
    if (
      cartridgeType === 0x0f ||
      cartridgeType === 0x10 ||
      cartridgeType === 0x11 ||
      cartridgeType === 0x12 ||
      cartridgeType === 0x13
    ) {
      return "MBC3";
    }
    if (cartridgeType >= 0x19 && cartridgeType <= 0x1e) return "MBC5";
    return undefined;
  }

  function create(rom, metadata, clock) {
    var header = parseHeader(rom);
    var mapper = mapperFor(header.cartridgeType);
    var romBanks = Math.max(1, Math.ceil(rom.length / 0x4000));
    var hasMbc3Rtc;
    var currentClock;
    var vram;
    var wram;
    var oam;
    var hram;
    var io;
    var cartRam;
    var framebuffer;
    var lineColors;
    var palette;
    var registers;
    var interruptEnable;
    var halted;
    var ime;
    var imeDelay;
    var divCounter;
    var timerCounter;
    var scanlineCycles;
    var ly;
    var frameCount;
    var buttons;
    var joypadSelect;
    var mbc1LowBank;
    var mbc1HighBank;
    var mbc1Mode;
    var mbc2RomBank;
    var mbc3RomBank;
    var mbc3RamBank;
    var mbc3RtcRegister;
    var mbc3LatchValue;
    var mbc5RomBank;
    var mbc5RamBank;
    var rtcSeconds;
    var rtcMinutes;
    var rtcHours;
    var rtcDays;
    var rtcHalted;
    var rtcCarry;
    var rtcLastUpdate;
    var rtcLatched;
    var ramEnabled;

    if (!mapper) throw new Error("Unsupported cartridge mapper");
    if (header.cgbFlag !== 0 && header.cgbFlag !== 0x80) {
      throw new Error("Game Boy Color ROM is unsupported");
    }
    hasMbc3Rtc = header.cartridgeType === 0x0f || header.cartridgeType === 0x10;
    currentClock = typeof clock === "function" ? clock : Date.now;

    vram = new Uint8Array(0x2000);
    wram = new Uint8Array(0x2000);
    oam = new Uint8Array(0xa0);
    hram = new Uint8Array(0x7f);
    io = new Uint8Array(0x80);
    cartRam = new Uint8Array(
      mapper === "MBC2" ? 0x0200 : ramLength(header.ramSizeCode),
    );
    rtcLatched = new Uint8Array(5);
    framebuffer = new Uint8Array((160 * 144) / 4);
    lineColors = new Uint8Array(160);
    palette = new Uint16Array([0xe7ff, 0x9df3, 0x4a69, 0x18c3]);

    function resetRegisters() {
      registers = {
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
      };
    }

    function resetIO() {
      var index;
      for (index = 0; index < io.length; index += 1) io[index] = 0;
      io[0x10] = 0x80;
      io[0x11] = 0xbf;
      io[0x12] = 0xf3;
      io[0x14] = 0xbf;
      io[0x16] = 0x3f;
      io[0x19] = 0xbf;
      io[0x1a] = 0x7f;
      io[0x1b] = 0xff;
      io[0x1c] = 0x9f;
      io[0x1e] = 0xbf;
      io[0x20] = 0xff;
      io[0x23] = 0xbf;
      io[0x24] = 0x77;
      io[0x25] = 0xf3;
      io[0x26] = 0xf1;
      io[0x40] = 0x91;
      io[0x41] = 0x85;
      io[0x47] = 0xfc;
      io[0x48] = 0xff;
      io[0x49] = 0xff;
      interruptEnable = 0;
      divCounter = 0xab00;
      timerCounter = 0;
      scanlineCycles = 0;
      ly = 0;
      frameCount = 0;
      buttons = 0;
      joypadSelect = 0x30;
      mbc1LowBank = 1;
      mbc1HighBank = 0;
      mbc1Mode = 0;
      mbc2RomBank = 1;
      mbc3RomBank = 1;
      mbc3RamBank = 0;
      mbc3RtcRegister = -1;
      mbc3LatchValue = 0;
      mbc5RomBank = 1;
      mbc5RamBank = 0;
      rtcSeconds = 0;
      rtcMinutes = 0;
      rtcHours = 0;
      rtcDays = 0;
      rtcHalted = false;
      rtcCarry = false;
      rtcLastUpdate = nowSeconds();
      rtcLatched[0] = 0;
      rtcLatched[1] = 0;
      rtcLatched[2] = 0;
      rtcLatched[3] = 0;
      rtcLatched[4] = 0;
      ramEnabled = false;
      halted = false;
      ime = false;
      imeDelay = 0;
      updateStat();
    }

    function reset() {
      resetRegisters();
      resetIO();
    }

    function getBC() {
      return (registers.b << 8) | registers.c;
    }

    function setBC(value) {
      value = word(value);
      registers.b = value >> 8;
      registers.c = value & 255;
    }

    function getDE() {
      return (registers.d << 8) | registers.e;
    }

    function setDE(value) {
      value = word(value);
      registers.d = value >> 8;
      registers.e = value & 255;
    }

    function getHL() {
      return (registers.h << 8) | registers.l;
    }

    function setHL(value) {
      value = word(value);
      registers.h = value >> 8;
      registers.l = value & 255;
    }

    function getAF() {
      return (registers.a << 8) | registers.f;
    }

    function setAF(value) {
      value = word(value);
      registers.a = value >> 8;
      registers.f = value & 0xf0;
    }

    function getFlag(flag) {
      return (registers.f & flag) !== 0;
    }

    function setFlag(flag, enabled) {
      if (enabled) registers.f |= flag;
      else registers.f &= ~flag;
    }

    function setFlags(zero, subtract, halfCarry, carry) {
      registers.f =
        (zero ? FLAG_Z : 0) |
        (subtract ? FLAG_N : 0) |
        (halfCarry ? FLAG_H : 0) |
        (carry ? FLAG_C : 0);
    }

    function readMappedRom(bank, offset) {
      var position;
      if (bank < 0 || bank >= romBanks) return 255;
      position = bank * 0x4000 + offset;
      return romByte(rom, position);
    }

    function mbc1Bank0() {
      return mbc1Mode ? mbc1HighBank << 5 : 0;
    }

    function mbc1BankN() {
      var bank = (mbc1HighBank << 5) | mbc1LowBank;
      if ((bank & 0x1f) === 0) bank |= 1;
      return bank;
    }

    function mbc5BankN() {
      return mbc5RomBank;
    }

    function mbc2BankN() {
      return mbc2RomBank;
    }

    function mbc3BankN() {
      return mbc3RomBank;
    }

    function nowSeconds() {
      var milliseconds = currentClock();
      if (typeof milliseconds !== "number" || milliseconds < 0) return 0;
      return Math.floor(milliseconds / 1000);
    }

    function rtcDayHigh() {
      return (
        ((rtcDays >> 8) & 1) | (rtcHalted ? 0x40 : 0) | (rtcCarry ? 0x80 : 0)
      );
    }

    function updateRtc() {
      var seconds;
      var elapsed;
      var total;
      if (!hasMbc3Rtc || rtcHalted) return;
      seconds = nowSeconds();
      elapsed = seconds - rtcLastUpdate;
      if (elapsed <= 0) return;
      total =
        rtcSeconds +
        rtcMinutes * 60 +
        rtcHours * 3600 +
        rtcDays * 86400 +
        elapsed;
      if (total >= 512 * 86400) {
        rtcCarry = true;
        total %= 512 * 86400;
      }
      rtcDays = Math.floor(total / 86400);
      total %= 86400;
      rtcHours = Math.floor(total / 3600);
      total %= 3600;
      rtcMinutes = Math.floor(total / 60);
      rtcSeconds = total % 60;
      rtcLastUpdate = seconds;
    }

    function latchRtc() {
      if (!hasMbc3Rtc) return;
      updateRtc();
      rtcLatched[0] = rtcSeconds;
      rtcLatched[1] = rtcMinutes;
      rtcLatched[2] = rtcHours;
      rtcLatched[3] = rtcDays & 255;
      rtcLatched[4] = rtcDayHigh();
    }

    function readRtcRegister(register) {
      if (register < 0x08 || register > 0x0c) return 255;
      return rtcLatched[register - 0x08];
    }

    function writeRtcRegister(register, value) {
      if (!hasMbc3Rtc) return;
      updateRtc();
      if (register === 0x08) rtcSeconds = value % 60;
      else if (register === 0x09) rtcMinutes = value % 60;
      else if (register === 0x0a) rtcHours = value % 24;
      else if (register === 0x0b) rtcDays = (rtcDays & 0x100) | value;
      else if (register === 0x0c) {
        rtcDays = (rtcDays & 255) | ((value & 1) << 8);
        rtcHalted = (value & 0x40) !== 0;
        rtcCarry = (value & 0x80) !== 0;
      }
      rtcLastUpdate = nowSeconds();
    }

    function readCartridge(address) {
      if (address < 0x4000) {
        if (mapper === "MBC1") return readMappedRom(mbc1Bank0(), address);
        return romByte(rom, address);
      }
      if (mapper === "MBC1")
        return readMappedRom(mbc1BankN(), address - 0x4000);
      if (mapper === "MBC2")
        return readMappedRom(mbc2BankN(), address - 0x4000);
      if (mapper === "MBC3")
        return readMappedRom(mbc3BankN(), address - 0x4000);
      if (mapper === "MBC5")
        return readMappedRom(mbc5BankN(), address - 0x4000);
      return romByte(rom, address);
    }

    function writeCartridge(address, value) {
      if (mapper === "MBC1") {
        if (address < 0x2000) {
          ramEnabled = (value & 15) === 10;
        } else if (address < 0x4000) {
          mbc1LowBank = value & 0x1f;
          if (mbc1LowBank === 0) mbc1LowBank = 1;
        } else if (address < 0x6000) {
          mbc1HighBank = value & 3;
        } else {
          mbc1Mode = value & 1;
        }
      } else if (mapper === "MBC2" && address < 0x4000) {
        if (address & 0x0100) {
          mbc2RomBank = value & 0x0f;
          if (mbc2RomBank === 0) mbc2RomBank = 1;
        } else {
          ramEnabled = (value & 15) === 10;
        }
      } else if (mapper === "MBC3") {
        if (address < 0x2000) {
          ramEnabled = (value & 15) === 10;
        } else if (address < 0x4000) {
          mbc3RomBank = value & 0x7f;
          if (mbc3RomBank === 0) mbc3RomBank = 1;
        } else if (address < 0x6000) {
          if (value < 4) {
            mbc3RamBank = value;
            mbc3RtcRegister = -1;
          } else if (hasMbc3Rtc && value >= 0x08 && value <= 0x0c) {
            mbc3RamBank = -1;
            mbc3RtcRegister = value;
          } else {
            mbc3RamBank = -1;
            mbc3RtcRegister = -1;
          }
        } else if (hasMbc3Rtc) {
          if (mbc3LatchValue === 0 && (value & 1) === 1) latchRtc();
          mbc3LatchValue = value & 1;
        }
      } else if (mapper === "MBC5") {
        if (address < 0x2000) {
          ramEnabled = (value & 15) === 10;
        } else if (address < 0x3000) {
          mbc5RomBank = (mbc5RomBank & 0x100) | value;
        } else if (address < 0x4000) {
          mbc5RomBank = (mbc5RomBank & 0xff) | ((value & 1) << 8);
        } else if (address < 0x6000) {
          mbc5RamBank = value & (header.cartridgeType >= 0x1c ? 7 : 15);
        }
      }
    }

    function ramBank() {
      if (mapper === "MBC1" && mbc1Mode) return mbc1HighBank;
      if (mapper === "MBC3") return mbc3RamBank;
      if (mapper === "MBC5") return mbc5RamBank;
      return 0;
    }

    function readExternalRam(address) {
      var index;
      if (mapper === "MBC2") {
        if (!ramEnabled) return 255;
        return 0xf0 | (cartRam[(address - 0xa000) & 0x01ff] & 15);
      }
      if (mapper === "MBC3" && mbc3RtcRegister >= 0) {
        if (!ramEnabled || !hasMbc3Rtc) return 255;
        return readRtcRegister(mbc3RtcRegister);
      }
      if (
        !cartRam.length ||
        ((mapper === "MBC1" || mapper === "MBC3" || mapper === "MBC5") &&
          !ramEnabled)
      ) {
        return 255;
      }
      index = ramBank() * 0x2000 + address - 0xa000;
      return index >= 0 && index < cartRam.length ? cartRam[index] : 255;
    }

    function writeExternalRam(address, value) {
      var index;
      if (mapper === "MBC2") {
        if (ramEnabled) cartRam[(address - 0xa000) & 0x01ff] = value & 15;
        return;
      }
      if (mapper === "MBC3" && mbc3RtcRegister >= 0) {
        if (ramEnabled && hasMbc3Rtc) {
          writeRtcRegister(mbc3RtcRegister, value);
        }
        return;
      }
      if (
        !cartRam.length ||
        ((mapper === "MBC1" || mapper === "MBC3" || mapper === "MBC5") &&
          !ramEnabled)
      ) {
        return;
      }
      index = ramBank() * 0x2000 + address - 0xa000;
      if (index >= 0 && index < cartRam.length) cartRam[index] = value;
    }

    function readJoypad() {
      var result = 0x0f;
      if ((joypadSelect & 0x10) === 0) {
        if (buttons & BUTTON_RIGHT) result &= ~1;
        if (buttons & BUTTON_LEFT) result &= ~2;
        if (buttons & BUTTON_UP) result &= ~4;
        if (buttons & BUTTON_DOWN) result &= ~8;
      }
      if ((joypadSelect & 0x20) === 0) {
        if (buttons & BUTTON_A) result &= ~1;
        if (buttons & BUTTON_B) result &= ~2;
        if (buttons & BUTTON_SELECT) result &= ~4;
        if (buttons & BUTTON_START) result &= ~8;
      }
      return 0xc0 | joypadSelect | result;
    }

    function readByte(address) {
      var index;
      address = word(address);
      if (address < 0x8000) return readCartridge(address);
      if (address < 0xa000) return vram[address - 0x8000];
      if (address < 0xc000) return readExternalRam(address);
      if (address < 0xe000) return wram[address - 0xc000];
      if (address < 0xfe00) return wram[address - 0xe000];
      if (address < 0xfea0) return oam[address - 0xfe00];
      if (address < 0xff00) return 255;
      if (address < 0xff80) {
        index = address - 0xff00;
        if (index === 0x00) return readJoypad();
        if (index === 0x04) return (divCounter >> 8) & 255;
        if (index === 0x0f) return io[index] | 0xe0;
        if (index === 0x41) return io[index] | 0x80;
        return io[index];
      }
      if (address < 0xffff) return hram[address - 0xff80];
      return interruptEnable;
    }

    function writeByte(address, value) {
      var index;
      var source;
      address = word(address);
      value = byte(value);
      if (address < 0x8000) {
        writeCartridge(address, value);
        return;
      }
      if (address < 0xa000) {
        vram[address - 0x8000] = value;
        return;
      }
      if (address < 0xc000) {
        writeExternalRam(address, value);
        return;
      }
      if (address < 0xe000) {
        wram[address - 0xc000] = value;
        return;
      }
      if (address < 0xfe00) {
        wram[address - 0xe000] = value;
        return;
      }
      if (address < 0xfea0) {
        oam[address - 0xfe00] = value;
        return;
      }
      if (address < 0xff00) return;
      if (address < 0xff80) {
        index = address - 0xff00;
        if (index === 0x00) {
          joypadSelect = value & 0x30;
          io[index] = joypadSelect;
          return;
        }
        if (index === 0x04) {
          divCounter = 0;
          io[index] = 0;
          return;
        }
        if (index === 0x0f) {
          io[index] = value & 0x1f;
          return;
        }
        if (index === 0x40) {
          io[index] = value;
          if ((value & 0x80) === 0) {
            ly = 0;
            scanlineCycles = 0;
            io[0x44] = 0;
          }
          updateStat();
          return;
        }
        if (index === 0x41) {
          io[index] = (io[index] & 7) | (value & 0x78);
          updateStat();
          return;
        }
        if (index === 0x44) {
          ly = 0;
          io[index] = 0;
          updateStat();
          return;
        }
        if (index === 0x45) {
          io[index] = value;
          updateStat();
          return;
        }
        if (index === 0x46) {
          for (source = 0; source < 0xa0; source += 1) {
            oam[source] = readByte((value << 8) + source);
          }
          io[index] = value;
          return;
        }
        io[index] = value;
        return;
      }
      if (address < 0xffff) {
        hram[address - 0xff80] = value;
        return;
      }
      interruptEnable = value;
    }

    function readWord(address) {
      return readByte(address) | (readByte(address + 1) << 8);
    }

    function writeWord(address, value) {
      writeByte(address, value);
      writeByte(address + 1, value >> 8);
    }

    function fetchByte() {
      var value = readByte(registers.pc);
      registers.pc = word(registers.pc + 1);
      return value;
    }

    function fetchWord() {
      var low = fetchByte();
      return low | (fetchByte() << 8);
    }

    function pushWord(value) {
      registers.sp = word(registers.sp - 1);
      writeByte(registers.sp, value >> 8);
      registers.sp = word(registers.sp - 1);
      writeByte(registers.sp, value);
    }

    function popWord() {
      var low = readByte(registers.sp);
      registers.sp = word(registers.sp + 1);
      return low | (readByte(registers.sp) << 8);
    }

    function requestInterrupt(bit) {
      io[0x0f] = (io[0x0f] | (1 << bit)) & 0x1f;
    }

    function updateStat() {
      var mode;
      var status = io[0x41] & 0x78;
      if ((io[0x40] & 0x80) === 0) mode = 0;
      else if (ly >= 144) mode = 1;
      else if (scanlineCycles < 80) mode = 2;
      else if (scanlineCycles < 252) mode = 3;
      else mode = 0;
      if (ly === io[0x45]) status |= 4;
      io[0x41] = status | mode;
    }

    function timerPeriod() {
      var selection = io[0x07] & 3;
      if (selection === 0) return 1024;
      if (selection === 1) return 16;
      if (selection === 2) return 64;
      return 256;
    }

    function tickTimer(cycles) {
      var period;
      divCounter = word(divCounter + cycles);
      if ((io[0x07] & 4) === 0) return;
      timerCounter += cycles;
      period = timerPeriod();
      while (timerCounter >= period) {
        timerCounter -= period;
        if (io[0x05] === 255) {
          io[0x05] = io[0x06];
          requestInterrupt(2);
        } else {
          io[0x05] += 1;
        }
      }
    }

    function setPixel(x, y, color) {
      var offset = (y * 160 + x) >> 2;
      var shift = (3 - (x & 3)) << 1;
      framebuffer[offset] =
        (framebuffer[offset] & ~(3 << shift)) | ((color & 3) << shift);
    }

    function paletteColor(paletteRegister, rawColor) {
      return (paletteRegister >> (rawColor << 1)) & 3;
    }

    function tilePixel(tileIndex, row, column, unsignedTiles) {
      var tileAddress;
      var low;
      var high;
      var bit;
      if (unsignedTiles) tileAddress = tileIndex << 4;
      else tileAddress = 0x1000 + (signedByte(tileIndex) << 4);
      low = vram[tileAddress + (row << 1)];
      high = vram[tileAddress + (row << 1) + 1];
      bit = 7 - column;
      return (((high >> bit) & 1) << 1) | ((low >> bit) & 1);
    }

    function mapPixel(mapAddress, pixelX, pixelY, unsignedTiles) {
      var tile = vram[mapAddress + ((pixelY >> 3) << 5) + (pixelX >> 3)];
      return tilePixel(tile, pixelY & 7, pixelX & 7, unsignedTiles);
    }

    function renderScanline(y) {
      var lcdc = io[0x40];
      var x;
      var raw;
      var mapAddress;
      var pixelX;
      var pixelY;
      var windowX;
      var sprite;
      var spriteX;
      var spriteY;
      var spriteRow;
      var spriteColumn;
      var spriteTile;
      var spriteAttributes;
      var spriteColor;
      var spriteHeight;

      if ((lcdc & 0x80) === 0) {
        for (x = 0; x < 160; x += 1) setPixel(x, y, 0);
        return;
      }

      mapAddress = lcdc & 8 ? 0x1c00 : 0x1800;
      for (x = 0; x < 160; x += 1) {
        raw = 0;
        if (lcdc & 1) {
          pixelX = (x + io[0x43]) & 255;
          pixelY = (y + io[0x42]) & 255;
          raw = mapPixel(mapAddress, pixelX, pixelY, (lcdc & 0x10) !== 0);
        }
        if (lcdc & 0x20 && y >= io[0x4a] && x >= io[0x4b] - 7) {
          windowX = x - (io[0x4b] - 7);
          if (windowX >= 0) {
            raw = mapPixel(
              lcdc & 0x40 ? 0x1c00 : 0x1800,
              windowX,
              y - io[0x4a],
              (lcdc & 0x10) !== 0,
            );
          }
        }
        lineColors[x] = raw;
        setPixel(x, y, paletteColor(io[0x47], raw));
      }

      if ((lcdc & 2) === 0) return;
      spriteHeight = lcdc & 4 ? 16 : 8;
      for (sprite = 39; sprite >= 0; sprite -= 1) {
        spriteY = oam[sprite * 4] - 16;
        if (y < spriteY || y >= spriteY + spriteHeight) continue;
        spriteX = oam[sprite * 4 + 1] - 8;
        spriteTile = oam[sprite * 4 + 2];
        spriteAttributes = oam[sprite * 4 + 3];
        spriteRow = y - spriteY;
        if (spriteAttributes & 0x40) spriteRow = spriteHeight - 1 - spriteRow;
        if (spriteHeight === 16) spriteTile &= 0xfe;
        if (spriteRow >= 8) {
          spriteTile += 1;
          spriteRow -= 8;
        }
        for (spriteColumn = 0; spriteColumn < 8; spriteColumn += 1) {
          x = spriteX + spriteColumn;
          if (x < 0 || x >= 160) continue;
          raw = spriteAttributes & 0x20 ? 7 - spriteColumn : spriteColumn;
          spriteColor = tilePixel(spriteTile, spriteRow, raw, true);
          if (!spriteColor) continue;
          if (spriteAttributes & 0x80 && lineColors[x] !== 0) continue;
          setPixel(
            x,
            y,
            paletteColor(
              spriteAttributes & 0x10 ? io[0x49] : io[0x48],
              spriteColor,
            ),
          );
        }
      }
    }

    function tickPpu(cycles) {
      if ((io[0x40] & 0x80) === 0) {
        ly = 0;
        scanlineCycles = 0;
        io[0x44] = 0;
        updateStat();
        return;
      }

      scanlineCycles += cycles;
      while (scanlineCycles >= 456) {
        scanlineCycles -= 456;
        if (ly < 144) renderScanline(ly);
        ly += 1;
        if (ly === 144) {
          requestInterrupt(0);
          frameCount += 1;
        }
        if (ly > 153) ly = 0;
      }
      io[0x44] = ly;
      updateStat();
    }

    function tick(cycles) {
      tickTimer(cycles);
      tickPpu(cycles);
    }

    function getRegister8(index) {
      if (index === 0) return registers.b;
      if (index === 1) return registers.c;
      if (index === 2) return registers.d;
      if (index === 3) return registers.e;
      if (index === 4) return registers.h;
      if (index === 5) return registers.l;
      if (index === 6) return readByte(getHL());
      return registers.a;
    }

    function setRegister8(index, value) {
      value = byte(value);
      if (index === 0) registers.b = value;
      else if (index === 1) registers.c = value;
      else if (index === 2) registers.d = value;
      else if (index === 3) registers.e = value;
      else if (index === 4) registers.h = value;
      else if (index === 5) registers.l = value;
      else if (index === 6) writeByte(getHL(), value);
      else registers.a = value;
    }

    function inc8(value) {
      var result = byte(value + 1);
      setFlag(FLAG_Z, result === 0);
      setFlag(FLAG_N, false);
      setFlag(FLAG_H, (value & 15) === 15);
      return result;
    }

    function dec8(value) {
      var result = byte(value - 1);
      setFlag(FLAG_Z, result === 0);
      setFlag(FLAG_N, true);
      setFlag(FLAG_H, (value & 15) === 0);
      return result;
    }

    function addA(value, carryIn) {
      var carry = carryIn && getFlag(FLAG_C) ? 1 : 0;
      var result = registers.a + value + carry;
      setFlags(
        (result & 255) === 0,
        false,
        (registers.a & 15) + (value & 15) + carry > 15,
        result > 255,
      );
      registers.a = byte(result);
    }

    function subA(value, carryIn) {
      var carry = carryIn && getFlag(FLAG_C) ? 1 : 0;
      var result = registers.a - value - carry;
      setFlags(
        (result & 255) === 0,
        true,
        (registers.a & 15) < (value & 15) + carry,
        result < 0,
      );
      registers.a = byte(result);
    }

    function andA(value) {
      registers.a &= value;
      setFlags(registers.a === 0, false, true, false);
    }

    function xorA(value) {
      registers.a ^= value;
      setFlags(registers.a === 0, false, false, false);
    }

    function orA(value) {
      registers.a |= value;
      setFlags(registers.a === 0, false, false, false);
    }

    function cpA(value) {
      var result = registers.a - value;
      setFlags(
        (result & 255) === 0,
        true,
        (registers.a & 15) < (value & 15),
        result < 0,
      );
    }

    function addHL(value) {
      var current = getHL();
      var result = current + value;
      setFlag(FLAG_N, false);
      setFlag(FLAG_H, (current & 0xfff) + (value & 0xfff) > 0xfff);
      setFlag(FLAG_C, result > 0xffff);
      setHL(result);
    }

    function addSP(signedValue) {
      var unsignedValue = signedValue & 255;
      var result = registers.sp + signedValue;
      setFlags(
        false,
        false,
        (registers.sp & 15) + (unsignedValue & 15) > 15,
        (registers.sp & 255) + unsignedValue > 255,
      );
      registers.sp = word(result);
    }

    function setHLFromSP(signedValue) {
      var unsignedValue = signedValue & 255;
      var result = registers.sp + signedValue;
      setFlags(
        false,
        false,
        (registers.sp & 15) + (unsignedValue & 15) > 15,
        (registers.sp & 255) + unsignedValue > 255,
      );
      setHL(result);
    }

    function daa() {
      var adjustment = 0;
      var carry = getFlag(FLAG_C);
      if (!getFlag(FLAG_N)) {
        if (getFlag(FLAG_H) || (registers.a & 15) > 9) adjustment |= 0x06;
        if (carry || registers.a > 0x99) {
          adjustment |= 0x60;
          carry = true;
        }
        registers.a = byte(registers.a + adjustment);
      } else {
        if (getFlag(FLAG_H)) adjustment |= 0x06;
        if (carry) adjustment |= 0x60;
        registers.a = byte(registers.a - adjustment);
      }
      setFlag(FLAG_Z, registers.a === 0);
      setFlag(FLAG_H, false);
      setFlag(FLAG_C, carry);
    }

    function condition(index) {
      if (index === 0) return !getFlag(FLAG_Z);
      if (index === 1) return getFlag(FLAG_Z);
      if (index === 2) return !getFlag(FLAG_C);
      return getFlag(FLAG_C);
    }

    function executeCb(opcode) {
      var register = opcode & 7;
      var operation = (opcode >> 3) & 7;
      var bit = (opcode >> 3) & 7;
      var value = getRegister8(register);
      var result;
      var carry;

      if (opcode < 0x40) {
        if (operation === 0) {
          carry = (value & 0x80) !== 0;
          result = byte((value << 1) | (carry ? 1 : 0));
        } else if (operation === 1) {
          carry = (value & 1) !== 0;
          result = (value >> 1) | (carry ? 0x80 : 0);
        } else if (operation === 2) {
          carry = getFlag(FLAG_C);
          result = byte((value << 1) | (carry ? 1 : 0));
          carry = (value & 0x80) !== 0;
        } else if (operation === 3) {
          carry = getFlag(FLAG_C);
          result = (value >> 1) | (carry ? 0x80 : 0);
          carry = (value & 1) !== 0;
        } else if (operation === 4) {
          carry = (value & 0x80) !== 0;
          result = byte(value << 1);
        } else if (operation === 5) {
          carry = (value & 1) !== 0;
          result = (value >> 1) | (value & 0x80);
        } else if (operation === 6) {
          carry = false;
          result = ((value & 15) << 4) | (value >> 4);
        } else {
          carry = (value & 1) !== 0;
          result = value >> 1;
        }
        setRegister8(register, result);
        setFlags(result === 0, false, false, carry);
        return register === 6 ? 16 : 8;
      }

      if (opcode < 0x80) {
        setFlag(FLAG_Z, (value & (1 << bit)) === 0);
        setFlag(FLAG_N, false);
        setFlag(FLAG_H, true);
        return register === 6 ? 12 : 8;
      }

      if (opcode < 0xc0) setRegister8(register, value & ~(1 << bit));
      else setRegister8(register, value | (1 << bit));
      return register === 6 ? 16 : 8;
    }

    function rst(vector) {
      pushWord(registers.pc);
      registers.pc = vector;
      return 16;
    }

    function execute(opcode) {
      var destination;
      var source;
      var value;
      var address;
      var offset;
      var taken;
      var group;

      if (opcode >= 0x40 && opcode <= 0x7f) {
        if (opcode === 0x76) {
          halted = true;
          return 4;
        }
        destination = (opcode >> 3) & 7;
        source = opcode & 7;
        setRegister8(destination, getRegister8(source));
        return destination === 6 || source === 6 ? 8 : 4;
      }

      if (opcode >= 0x80 && opcode <= 0xbf) {
        source = opcode & 7;
        value = getRegister8(source);
        group = (opcode >> 3) & 7;
        if (group === 0) addA(value, false);
        else if (group === 1) addA(value, true);
        else if (group === 2) subA(value, false);
        else if (group === 3) subA(value, true);
        else if (group === 4) andA(value);
        else if (group === 5) xorA(value);
        else if (group === 6) orA(value);
        else cpA(value);
        return source === 6 ? 8 : 4;
      }

      switch (opcode) {
        case 0x00:
          return 4;
        case 0x01:
          setBC(fetchWord());
          return 12;
        case 0x02:
          writeByte(getBC(), registers.a);
          return 8;
        case 0x03:
          setBC(getBC() + 1);
          return 8;
        case 0x04:
          registers.b = inc8(registers.b);
          return 4;
        case 0x05:
          registers.b = dec8(registers.b);
          return 4;
        case 0x06:
          registers.b = fetchByte();
          return 8;
        case 0x07:
          value = (registers.a & 0x80) !== 0;
          registers.a = byte((registers.a << 1) | (value ? 1 : 0));
          setFlags(false, false, false, value);
          return 4;
        case 0x08:
          writeWord(fetchWord(), registers.sp);
          return 20;
        case 0x09:
          addHL(getBC());
          return 8;
        case 0x0a:
          registers.a = readByte(getBC());
          return 8;
        case 0x0b:
          setBC(getBC() - 1);
          return 8;
        case 0x0c:
          registers.c = inc8(registers.c);
          return 4;
        case 0x0d:
          registers.c = dec8(registers.c);
          return 4;
        case 0x0e:
          registers.c = fetchByte();
          return 8;
        case 0x0f:
          value = (registers.a & 1) !== 0;
          registers.a = (registers.a >> 1) | (value ? 0x80 : 0);
          setFlags(false, false, false, value);
          return 4;
        case 0x10:
          fetchByte();
          halted = true;
          return 4;
        case 0x11:
          setDE(fetchWord());
          return 12;
        case 0x12:
          writeByte(getDE(), registers.a);
          return 8;
        case 0x13:
          setDE(getDE() + 1);
          return 8;
        case 0x14:
          registers.d = inc8(registers.d);
          return 4;
        case 0x15:
          registers.d = dec8(registers.d);
          return 4;
        case 0x16:
          registers.d = fetchByte();
          return 8;
        case 0x17:
          value = getFlag(FLAG_C);
          setFlag(FLAG_C, (registers.a & 0x80) !== 0);
          registers.a = byte((registers.a << 1) | (value ? 1 : 0));
          setFlag(FLAG_Z, false);
          setFlag(FLAG_N, false);
          setFlag(FLAG_H, false);
          return 4;
        case 0x18:
          registers.pc = word(registers.pc + signedByte(fetchByte()));
          return 12;
        case 0x19:
          addHL(getDE());
          return 8;
        case 0x1a:
          registers.a = readByte(getDE());
          return 8;
        case 0x1b:
          setDE(getDE() - 1);
          return 8;
        case 0x1c:
          registers.e = inc8(registers.e);
          return 4;
        case 0x1d:
          registers.e = dec8(registers.e);
          return 4;
        case 0x1e:
          registers.e = fetchByte();
          return 8;
        case 0x1f:
          value = getFlag(FLAG_C);
          setFlag(FLAG_C, (registers.a & 1) !== 0);
          registers.a = (registers.a >> 1) | (value ? 0x80 : 0);
          setFlag(FLAG_Z, false);
          setFlag(FLAG_N, false);
          setFlag(FLAG_H, false);
          return 4;
        case 0x20:
        case 0x28:
        case 0x30:
        case 0x38:
          offset = signedByte(fetchByte());
          taken = condition((opcode >> 3) & 3);
          if (taken) registers.pc = word(registers.pc + offset);
          return taken ? 12 : 8;
        case 0x21:
          setHL(fetchWord());
          return 12;
        case 0x22:
          writeByte(getHL(), registers.a);
          setHL(getHL() + 1);
          return 8;
        case 0x23:
          setHL(getHL() + 1);
          return 8;
        case 0x24:
          registers.h = inc8(registers.h);
          return 4;
        case 0x25:
          registers.h = dec8(registers.h);
          return 4;
        case 0x26:
          registers.h = fetchByte();
          return 8;
        case 0x27:
          daa();
          return 4;
        case 0x29:
          addHL(getHL());
          return 8;
        case 0x2a:
          registers.a = readByte(getHL());
          setHL(getHL() + 1);
          return 8;
        case 0x2b:
          setHL(getHL() - 1);
          return 8;
        case 0x2c:
          registers.l = inc8(registers.l);
          return 4;
        case 0x2d:
          registers.l = dec8(registers.l);
          return 4;
        case 0x2e:
          registers.l = fetchByte();
          return 8;
        case 0x2f:
          registers.a ^= 0xff;
          setFlag(FLAG_N, true);
          setFlag(FLAG_H, true);
          return 4;
        case 0x31:
          registers.sp = fetchWord();
          return 12;
        case 0x32:
          writeByte(getHL(), registers.a);
          setHL(getHL() - 1);
          return 8;
        case 0x33:
          registers.sp = word(registers.sp + 1);
          return 8;
        case 0x34:
          address = getHL();
          writeByte(address, inc8(readByte(address)));
          return 12;
        case 0x35:
          address = getHL();
          writeByte(address, dec8(readByte(address)));
          return 12;
        case 0x36:
          writeByte(getHL(), fetchByte());
          return 12;
        case 0x37:
          setFlag(FLAG_N, false);
          setFlag(FLAG_H, false);
          setFlag(FLAG_C, true);
          return 4;
        case 0x39:
          addHL(registers.sp);
          return 8;
        case 0x3a:
          registers.a = readByte(getHL());
          setHL(getHL() - 1);
          return 8;
        case 0x3b:
          registers.sp = word(registers.sp - 1);
          return 8;
        case 0x3c:
          registers.a = inc8(registers.a);
          return 4;
        case 0x3d:
          registers.a = dec8(registers.a);
          return 4;
        case 0x3e:
          registers.a = fetchByte();
          return 8;
        case 0x3f:
          setFlag(FLAG_N, false);
          setFlag(FLAG_H, false);
          setFlag(FLAG_C, !getFlag(FLAG_C));
          return 4;
        case 0xc0:
        case 0xc8:
        case 0xd0:
        case 0xd8:
          if (condition((opcode >> 3) & 3)) {
            registers.pc = popWord();
            return 20;
          }
          return 8;
        case 0xc1:
          setBC(popWord());
          return 12;
        case 0xc2:
        case 0xca:
        case 0xd2:
        case 0xda:
          address = fetchWord();
          if (condition((opcode >> 3) & 3)) {
            registers.pc = address;
            return 16;
          }
          return 12;
        case 0xc3:
          registers.pc = fetchWord();
          return 16;
        case 0xc4:
        case 0xcc:
        case 0xd4:
        case 0xdc:
          address = fetchWord();
          if (condition((opcode >> 3) & 3)) {
            pushWord(registers.pc);
            registers.pc = address;
            return 24;
          }
          return 12;
        case 0xc5:
          pushWord(getBC());
          return 16;
        case 0xc6:
          addA(fetchByte(), false);
          return 8;
        case 0xc7:
          return rst(0x00);
        case 0xc9:
          registers.pc = popWord();
          return 16;
        case 0xcb:
          return executeCb(fetchByte());
        case 0xcd:
          address = fetchWord();
          pushWord(registers.pc);
          registers.pc = address;
          return 24;
        case 0xce:
          addA(fetchByte(), true);
          return 8;
        case 0xcf:
          return rst(0x08);
        case 0xd1:
          setDE(popWord());
          return 12;
        case 0xd5:
          pushWord(getDE());
          return 16;
        case 0xd6:
          subA(fetchByte(), false);
          return 8;
        case 0xd7:
          return rst(0x10);
        case 0xd9:
          registers.pc = popWord();
          ime = true;
          imeDelay = 0;
          return 16;
        case 0xde:
          subA(fetchByte(), true);
          return 8;
        case 0xdf:
          return rst(0x18);
        case 0xe0:
          writeByte(0xff00 + fetchByte(), registers.a);
          return 12;
        case 0xe1:
          setHL(popWord());
          return 12;
        case 0xe2:
          writeByte(0xff00 + registers.c, registers.a);
          return 8;
        case 0xe5:
          pushWord(getHL());
          return 16;
        case 0xe6:
          andA(fetchByte());
          return 8;
        case 0xe7:
          return rst(0x20);
        case 0xe8:
          addSP(signedByte(fetchByte()));
          return 16;
        case 0xe9:
          registers.pc = getHL();
          return 4;
        case 0xea:
          writeByte(fetchWord(), registers.a);
          return 16;
        case 0xee:
          xorA(fetchByte());
          return 8;
        case 0xef:
          return rst(0x28);
        case 0xf0:
          registers.a = readByte(0xff00 + fetchByte());
          return 12;
        case 0xf1:
          setAF(popWord());
          return 12;
        case 0xf2:
          registers.a = readByte(0xff00 + registers.c);
          return 8;
        case 0xf3:
          ime = false;
          imeDelay = 0;
          return 4;
        case 0xf5:
          pushWord(getAF());
          return 16;
        case 0xf6:
          orA(fetchByte());
          return 8;
        case 0xf7:
          return rst(0x30);
        case 0xf8:
          setHLFromSP(signedByte(fetchByte()));
          return 12;
        case 0xf9:
          registers.sp = getHL();
          return 8;
        case 0xfa:
          registers.a = readByte(fetchWord());
          return 16;
        case 0xfb:
          imeDelay = 2;
          return 4;
        case 0xfe:
          cpA(fetchByte());
          return 8;
        case 0xff:
          return rst(0x38);
        default:
          throw new Error("Unsupported opcode 0x" + opcode.toString(16));
      }
    }

    function serviceInterrupt() {
      var requested = io[0x0f] & interruptEnable & 0x1f;
      var bit;
      if (!requested) return 0;
      halted = false;
      if (!ime) return 0;
      for (bit = 0; bit < 5; bit += 1) {
        if (requested & (1 << bit)) {
          ime = false;
          imeDelay = 0;
          io[0x0f] &= ~(1 << bit);
          pushWord(registers.pc);
          registers.pc = 0x40 + bit * 8;
          return 20;
        }
      }
      return 0;
    }

    function step() {
      var cycles = serviceInterrupt();
      if (!cycles) {
        if (halted) cycles = 4;
        else {
          cycles = execute(fetchByte());
          if (imeDelay) {
            imeDelay -= 1;
            if (!imeDelay) ime = true;
          }
        }
      }
      tick(cycles);
      return cycles;
    }

    function runCycles(budget) {
      var used = 0;
      while (used < budget) used += step();
      return used;
    }

    function runFrame() {
      var target = frameCount + 1;
      var guard = 0;
      while (frameCount < target && guard < 1000000) {
        step();
        guard += 1;
      }
      return frameCount >= target;
    }

    function setButtons(nextButtons) {
      var pressed = ~buttons & nextButtons;
      buttons = nextButtons & 255;
      if (pressed) requestInterrupt(4);
    }

    function saveDataByte(data, index) {
      return typeof data === "string"
        ? data.charCodeAt(index) & 255
        : data[index] & 255;
    }

    function copySaveRam(data, offset) {
      var index;
      if (!data) return;
      for (
        index = 0;
        index < cartRam.length && index + offset < data.length;
        index += 1
      ) {
        cartRam[index] = saveDataByte(data, index + offset);
      }
    }

    function isRtcSaveData(data) {
      return (
        hasMbc3Rtc &&
        data &&
        data.length >= 14 &&
        saveDataByte(data, 0) === 0x47 &&
        saveDataByte(data, 1) === 0x42 &&
        saveDataByte(data, 2) === 0x52 &&
        saveDataByte(data, 3) === 0x54 &&
        saveDataByte(data, 4) === 1
      );
    }

    function getSaveData() {
      var data;
      var index;
      var timestamp;
      if (!hasMbc3Rtc) return cartRam;
      updateRtc();
      data = new Uint8Array(14 + cartRam.length);
      timestamp = rtcLastUpdate >>> 0;
      data[0] = 0x47;
      data[1] = 0x42;
      data[2] = 0x52;
      data[3] = 0x54;
      data[4] = 1;
      data[5] = rtcSeconds;
      data[6] = rtcMinutes;
      data[7] = rtcHours;
      data[8] = rtcDays & 255;
      data[9] = rtcDayHigh();
      data[10] = timestamp & 255;
      data[11] = (timestamp >>> 8) & 255;
      data[12] = (timestamp >>> 16) & 255;
      data[13] = (timestamp >>> 24) & 255;
      for (index = 0; index < cartRam.length; index += 1) {
        data[index + 14] = cartRam[index];
      }
      return data;
    }

    function loadSaveData(data) {
      var timestamp;
      if (!data) return;
      if (!isRtcSaveData(data)) {
        copySaveRam(data, 0);
        return;
      }
      rtcSeconds = saveDataByte(data, 5) % 60;
      rtcMinutes = saveDataByte(data, 6) % 60;
      rtcHours = saveDataByte(data, 7) % 24;
      rtcDays = saveDataByte(data, 8) | ((saveDataByte(data, 9) & 1) << 8);
      rtcHalted = (saveDataByte(data, 9) & 0x40) !== 0;
      rtcCarry = (saveDataByte(data, 9) & 0x80) !== 0;
      timestamp =
        saveDataByte(data, 10) |
        (saveDataByte(data, 11) << 8) |
        (saveDataByte(data, 12) << 16) |
        (saveDataByte(data, 13) << 24);
      rtcLastUpdate = timestamp >>> 0;
      copySaveRam(data, 14);
      latchRtc();
    }

    reset();

    return {
      info: {
        title: (metadata && metadata.title) || header.title,
        mapper: mapper,
        cartridgeType: header.cartridgeType,
        romSizeCode: header.romSizeCode,
      },
      readByte: readByte,
      writeByte: writeByte,
      step: step,
      runCycles: runCycles,
      runFrame: runFrame,
      reset: reset,
      setButtons: setButtons,
      getRegisters: function () {
        return registers;
      },
      getFrameBuffer: function () {
        return framebuffer;
      },
      getFrame: function () {
        return {
          width: 160,
          height: 144,
          bpp: 2,
          buffer: framebuffer.buffer,
          palette: palette,
        };
      },
      getFrameCount: function () {
        return frameCount;
      },
      getSaveRam: function () {
        return cartRam;
      },
      getSaveData: getSaveData,
      loadSaveRam: function (data) {
        copySaveRam(data, 0);
      },
      loadSaveData: loadSaveData,
      isHalted: function () {
        return halted;
      },
    };
  }

  var api = {
    create: create,
    parseHeader: parseHeader,
    ROM_ONLY: ROM_ONLY,
    BUTTON_RIGHT: BUTTON_RIGHT,
    BUTTON_LEFT: BUTTON_LEFT,
    BUTTON_UP: BUTTON_UP,
    BUTTON_DOWN: BUTTON_DOWN,
    BUTTON_A: BUTTON_A,
    BUTTON_B: BUTTON_B,
    BUTTON_SELECT: BUTTON_SELECT,
    BUTTON_START: BUTTON_START,
  };

  if (typeof module !== "undefined") module.exports = api;
  else exports = api;
})();

