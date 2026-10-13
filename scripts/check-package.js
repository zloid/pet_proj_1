"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = path.join(root, "apps", "gbemu");
const metadata = JSON.parse(
  fs.readFileSync(path.join(app, "metadata.json"), "utf8"),
);
const requiredStorage = ["gbemu.app.js", "gbemu.engine", "gbemu.img"];

if (metadata.id !== "gbemu") throw new Error("metadata id must be gbemu");
if (
  !Array.isArray(metadata.supports) ||
  !metadata.supports.includes("BANGLEJS2")
) {
  throw new Error("metadata must support BANGLEJS2");
}
if (!metadata.icon || !fs.existsSync(path.join(app, metadata.icon))) {
  throw new Error("metadata icon is missing");
}
if (!metadata.interface || !fs.existsSync(path.join(app, metadata.interface))) {
  throw new Error("metadata interface is missing");
}

const storedNames = metadata.storage.map((file) => file.name);
requiredStorage.forEach((name) => {
  if (!storedNames.includes(name))
    throw new Error("missing storage file: " + name);
  if (name.length > 28)
    throw new Error("storage filename is too long: " + name);
});

metadata.storage.forEach((file) => {
  if (file.url && !fs.existsSync(path.join(app, file.url))) {
    throw new Error("missing package source: " + file.url);
  }
});

["app.js", "gbemu.engine.js", "app-icon.js"].forEach((filename) => {
  const source = fs.readFileSync(path.join(app, filename), "utf8");
  new vm.Script(source, { filename });
});

const icon = vm.runInNewContext(
  fs.readFileSync(path.join(app, "app-icon.js"), "utf8"),
  { Uint8Array },
);
if (!(icon instanceof ArrayBuffer) || icon.byteLength !== 291) {
  throw new Error("app icon must be a 48x48 1-bpp image");
}

const interfaceHtml = fs.readFileSync(
  path.join(app, metadata.interface),
  "utf8",
);
const inlineScript = interfaceHtml.match(/<script>\s*([\s\S]*?)<\/script>/);
if (!inlineScript) throw new Error("ROM importer has no inline script");
new vm.Script(inlineScript[1], { filename: metadata.interface });

console.log("Bangle package shape and JavaScript syntax are valid.");

