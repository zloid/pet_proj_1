# Bangle.js Game Boy DMG MVP

This repository contains a Bangle.js 2 App Loader compatible Game Boy DMG emulator MVP.

The app itself contains no commercial ROMs. Load only homebrew or ROM dumps that you are entitled to use.

## Project layout

- `apps/gbemu`: App Loader submission package.
- `handoff`: numbered plain-text continuation notes.
- `tests`: host-side checks for the emulator components.

## Current MVP path

1. Install the app package.
2. Open the app's App Loader interface and upload a raw `.gb` or `.bin` ROM.
3. Open the app, tap the start screen, and choose a ROM.

## Compatibility

The importer and engine support these DMG cartridge types:

- ROM ONLY: `0x00`, `0x08`, `0x09`.
- MBC1: `0x01` through `0x03`.
- MBC2: `0x05`, `0x06`.
- MBC3, including RTC: `0x0f` through `0x13`.
- MBC5: `0x19` through `0x1e`; rumble is ignored.

Cartridge RAM is stored as `gbemu.save.<crc>` and is removed with its ROM from the App Loader interface. RTC cartridges store their clock state in the same save file and use the Bangle system clock, which should be synchronized before play. CGB-only ROMs, audio, and other special mappers remain unsupported.

See the numbered files in `handoff` for the exact current state and next action at every milestone.

