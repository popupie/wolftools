import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unpackArchive } from "../unpack.mjs";

const signature = Buffer.from([0, 0x57, 0, 0, 0x4f, 0x4c, 0, 0x46, 0x4d]);
const slots = ["main", "subfont 1", "subfont 2", "subfont 3"];
const fontKey = (name) => name.trim().normalize("NFC");

// Read-only layout reference:
// https://github.com/djytw/wolf-rpg-formats/blob/master/game_dat.ksy
export function parseGameDatFonts(bytes) {
  if (
    !bytes.subarray(0, signature.length).equals(signature) ||
    ![0, 0x55].includes(bytes[9])
  )
    throw new Error("Unsupported or encrypted Game.dat header.");

  let position = 10;
  function take(length) {
    if (length > bytes.length - position)
      throw new Error(`Truncated Game.dat settings at byte ${position}.`);
    const value = bytes.subarray(position, position + length);
    position += length;
    return value;
  }
  const integer = () => take(4).readUInt32LE();
  const block = () => take(integer());
  const encoding = bytes[9] === 0x55 ? "utf8" : "cp932";
  const decoder = new TextDecoder(encoding === "utf8" ? "utf-8" : "shift_jis", {
    fatal: true,
  });
  function string() {
    const value = block();
    if (
      !value.length ||
      value.at(-1) !== 0 ||
      value.subarray(0, -1).includes(0)
    )
      throw new Error("Invalid Game.dat settings string.");
    return decoder.decode(value.subarray(0, -1));
  }

  block(); // Byte settings. The length varies between engine versions.
  const count = integer();
  if (count < 8 || count > 1024)
    throw new Error("Unsupported Game.dat string settings count.");
  string(); // Title, which can itself contain text resembling a font name.
  if (string() !== "0000-0000")
    throw new Error("Invalid Game.dat settings marker.");
  block(); // Encryption key, not a text field to decode or report.
  const fonts = slots.map((slot) => {
    const name = fontKey(string());
    if (/[\x00-\x1f\x7f]/u.test(name))
      throw new Error(`Invalid Game.dat ${slot} font name.`);
    return { slot, name };
  });
  return { encoding, fonts };
}

function absent(error) {
  if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
}

async function readSettings(dataDir) {
  let path = dataDir;
  for (const [index, name] of ["BasicData", "Game.dat"].entries()) {
    const entries = await readdir(path, { withFileTypes: true }).catch(absent);
    if (!entries) return;
    const matches = entries.filter(
      (entry) =>
        entry.name.toLowerCase() === name.toLowerCase() &&
        (index === 0 ? entry.isDirectory() : entry.isFile()),
    );
    const entry =
      matches.find((entry) => entry.name === name) ??
      (matches.length === 1 ? matches[0] : undefined);
    if (!entry) {
      if (matches.length > 1) throw new Error(`Ambiguous ${name} path.`);
      return;
    }
    path = join(path, entry.name);
  }
  return readFile(path);
}

async function settingsBytes(dataDir, archivePath) {
  if (dataDir) return readSettings(dataDir);
  const temporary = await mkdtemp(join(tmpdir(), "wolftools-font-settings-"));
  try {
    await unpackArchive(archivePath, temporary, {
      includeFile: (name) => /^Game\.dat$/iu.test(name),
    });
    return await readSettings(temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function decodeFontList(value) {
  if (typeof value === "string") return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return new TextDecoder("shift_jis", { fatal: true }).decode(value);
  }
}

function fontPath(value) {
  const parts = value.replaceAll("\\", "/").split("/");
  if (
    !value ||
    /[\x00-\x1f:]/u.test(value) ||
    !parts[0] ||
    parts.includes("..")
  )
    return;
  return parts.filter((part) => part && part !== ".").join("/");
}

async function isFile(path) {
  const details = await stat(path).catch(absent);
  return !!details?.isFile() && details.size > 0;
}

export function reportGameFonts(result) {
  if (!result) return;
  if (result.error) {
    console.warn(
      `Could not inspect WOLF fonts in ${result.source}: ${result.error}`,
    );
    return;
  }
  const { source, fonts, missing } = result;
  console.log(
    `WOLF fonts from ${source}: ${fonts
      .map((font) => `${font.slot}=${JSON.stringify(font.name || "(default)")}`)
      .join(", ")}`,
  );
  for (const name of missing) {
    const usedBy = fonts
      .filter((font) => font.name === name)
      .map((font) => font.slot);
    console.warn(
      `Font ${JSON.stringify(name)} (${usedBy.join(", ")}) is not available.`,
    );
  }
}

// This runs during export and every --migrate invocation.
export async function checkGameFonts({
  dataDir,
  archivePath,
  outputDir,
  pending = new Map(),
  report = true,
}) {
  if (!dataDir && !archivePath) return;
  const source = dataDir
    ? "Data/BasicData/Game.dat"
    : "Data.wolf:BasicData/Game.dat";
  try {
    const bytes = await settingsBytes(dataDir, archivePath);
    if (!bytes) return;
    const parsed = parseGameDatFonts(bytes);
    let list = pending.get("FontList.ini");
    if (list?.sourcePath) list = await readFile(list.sourcePath);
    if (list === undefined)
      list =
        (await readFile(join(outputDir, "FontList.ini")).catch(absent)) ?? "";
    const registered = new Map();
    for (const line of decodeFontList(list)
      .replace(/^\uFEFF/u, "")
      .split(/\r?\n/u)) {
      if (/^\s*[;#]/u.test(line)) continue;
      const at = line.indexOf("=");
      if (at < 1) continue;
      const path = fontPath(line.slice(0, at).trim());
      if (path) registered.set(fontKey(line.slice(at + 1)), path);
    }
    const available = new Map();
    async function availableFile(path) {
      if (!available.has(path)) {
        const update = pending.get(path);
        const exists = update?.sourcePath
          ? await isFile(update.sourcePath)
          : update !== undefined
            ? update.length > 0
            : await isFile(join(outputDir, path));
        available.set(path, exists);
      }
      return available.get(path);
    }

    const fonts = [];
    for (const font of parsed.fonts) {
      const file = registered.get(font.name);
      let status = "default";
      if (font.name)
        status = file && (await availableFile(file)) ? "available" : "missing";
      fonts.push({
        ...font,
        status,
        ...(status === "available" ? { file } : {}),
      });
    }
    const missing = [
      ...new Set(
        fonts
          .filter((font) => font.status === "missing")
          .map((font) => font.name),
      ),
    ];
    const result = { source, ...parsed, fonts, missing };
    if (report) reportGameFonts(result);
    return result;
  } catch (error) {
    const result = { source, error: error.message };
    if (report) reportGameFonts(result);
    return result;
  }
}
