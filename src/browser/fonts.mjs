import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export const FONT_FILE = /\.(?:otf|ttf)$/iu;
const fontListPath = "FontList.ini";
const defaultFonts = new Set(["DefaultFont.ttf", "DefaultSubFont.ttf"]);
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const utf16 = new TextDecoder("utf-16be", { fatal: true });
const macRoman = new TextDecoder("macintosh");

function fontNames(bytes) {
  if (bytes.length < 12) return [];
  const signature = bytes.readUInt32BE(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f) return [];
  const tableEnd = 12 + 16 * bytes.readUInt16BE(4);
  if (tableEnd > bytes.length) return [];

  for (let entry = 12; entry < tableEnd; entry += 16) {
    if (bytes.toString("ascii", entry, entry + 4) !== "name") continue;
    const start = bytes.readUInt32BE(entry + 8);
    const length = bytes.readUInt32BE(entry + 12);
    if (length < 6 || start + length > bytes.length) return [];
    return namingTable(bytes.subarray(start, start + length));
  }
  return [];
}

function namingTable(table) {
  const recordsEnd = 6 + 12 * table.readUInt16BE(2);
  const strings = table.readUInt16BE(4);
  if (recordsEnd > strings || strings > table.length) return [];

  const names = new Set();
  for (let entry = 6; entry < recordsEnd; entry += 12) {
    const platform = table.readUInt16BE(entry);
    const encoding = table.readUInt16BE(entry + 2);
    const name = table.readUInt16BE(entry + 6);
    if (name !== 1 && name !== 4) continue;
    const decoder =
      platform === 0 || (platform === 3 && [0, 1, 10].includes(encoding))
        ? utf16
        : platform === 1 && encoding === 0
          ? macRoman
          : undefined;
    if (!decoder) continue;
    const start = strings + table.readUInt16BE(entry + 10);
    const end = start + table.readUInt16BE(entry + 8);
    if (end > table.length) continue;
    try {
      const value = decoder.decode(table.subarray(start, end)).trim();
      if (value && !/[=\r\n\x00]/u.test(value))
        names.add(value.normalize("NFC"));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return [...names];
}

function absent(error) {
  if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
}

export async function browserFontUpdates(outputDir, gameRoot, looseFonts) {
  const updates = new Map();
  const outputList = join(outputDir, fontListPath);
  const exportedList = await readFile(outputList).catch(absent);
  const list =
    exportedList ??
    (await readFile(join(gameRoot, fontListPath)).catch(absent));
  if (!list) return updates;

  // Preserve mappings, including their original spelling and order.
  let content;
  try {
    content = utf8.decode(list);
  } catch (error) {
    if (error instanceof TypeError) return updates;
    throw error;
  }
  const rootFonts = new Map(
    (await readdir(gameRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && FONT_FILE.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => [entry.name, join(gameRoot, entry.name)]),
  );
  const registered = new Set();
  const published = new Map();
  for (const line of content.split(/\r?\n/u)) {
    if (/^\s*[;#]/u.test(line)) continue;
    const delimiter = line.indexOf("=");
    if (delimiter < 1) continue;
    const filename = line.slice(0, delimiter).trim();
    registered.add(
      line
        .slice(delimiter + 1)
        .trim()
        .normalize("NFC"),
    );
    const sourcePath = rootFonts.get(filename);
    if (!sourcePath) continue;
    if (!(await stat(join(outputDir, filename)).catch(absent))?.isFile())
      updates.set(filename, { sourcePath });
    published.set(sourcePath, filename);
  }

  const additions = [];
  const customRootFonts = [...rootFonts.values()].filter(
    (path) => !defaultFonts.has(basename(path)),
  );
  for (const sourcePath of [...customRootFonts, ...looseFonts]) {
    const bytes = await readFile(sourcePath).catch(absent);
    if (!bytes) continue;
    const names = fontNames(bytes).filter((name) => !registered.has(name));
    if (!names.length) continue;

    let filename = published.get(sourcePath);
    if (!filename) {
      // Use a URL-safe filename. All localized names share one copy.
      const hash = createHash("sha256")
        .update(bytes)
        .digest("hex")
        .slice(0, 16);
      filename = `assets/wolftools-font-${hash}${extname(sourcePath).toLowerCase()}`;
      updates.set(filename, { sourcePath });
    }
    for (const name of names) {
      registered.add(name);
      additions.push(`${filename}=${name}`);
    }
  }
  if (additions.length) {
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const separator = content && !content.endsWith("\n") ? newline : "";
    updates.set(
      fontListPath,
      content + separator + additions.join(newline) + newline,
    );
  } else if (!exportedList) {
    updates.set(fontListPath, list);
  }
  return updates;
}
