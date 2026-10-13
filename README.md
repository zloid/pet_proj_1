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

## Espruino Web IDE

The project can generate one JavaScript installer for direct paste into the
Espruino Web IDE. It installs the engine, application, launcher metadata, and
icon into Bangle Storage, then launches the app.

```sh
npm run web-ide
```

Open `dist/gbemu-web-ide.js`, copy all of its contents into the Web IDE's left
editor pane. First select **Connect**, choose **Bangle.js 2** in emulator mode
(or connect your physical watch), and confirm that the terminal says
`Connected to Emulator` or displays `Found BANGLEJS2`. Then choose **Send to
Espruino**. The default installer does not contain a ROM; it preserves any
library already on the watch.

To install one DMG ROM at the same time, generate the installer with a ROM you
are entitled to use:

```sh
npm run web-ide -- --rom "C:\path\to\homebrew.gb"
```

This creates the same `gbemu.roms.json` library entry expected by the app. For
multiple ROMs or deleting ROMs later, use the App Loader interface instead.

## Add ROMs After Installation

To add ROMs without rebuilding or reinstalling the emulator, open
`tools/gbemu-rom-uploader.html` in a desktop browser. Choose a legal `.gb` or
`.bin` DMG ROM, select **Build Script**, then **Copy**. In the Espruino Web IDE,
connect to the same Bangle.js 2, paste the generated script into the editor,
and choose **Send to Espruino**.

The script writes only the selected ROM and its `gbemu.roms.json` library
entry, then opens GBEMU. On the watch, tap the start screen and select the ROM
from the library. "Any ROM" here means any legal, supported DMG ROM that fits
the watch's available storage; CGB-only ROMs and unsupported cartridge hardware
are rejected.

## Compatibility

The importer and engine support these DMG cartridge types:

- ROM ONLY: `0x00`, `0x08`, `0x09`.
- MBC1: `0x01` through `0x03`.
- MBC2: `0x05`, `0x06`.
- MBC3, including RTC: `0x0f` through `0x13`.
- MBC5: `0x19` through `0x1e`; rumble is ignored.

Cartridge RAM is stored as `gbemu.save.<crc>` and is removed with its ROM from the App Loader interface. RTC cartridges store their clock state in the same save file and use the Bangle system clock, which should be synchronized before play. CGB-only ROMs, audio, and other special mappers remain unsupported.

See the numbered files in `handoff` for the exact current state and next action at every milestone.

