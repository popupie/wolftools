import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { listFiles } from "../files.mjs";
import { unpackArchive } from "../unpack.mjs";
import {
  extractFontFace,
  fontDirectories,
  fontNameTable,
} from "./font-collection.mjs";

export const FONT_FILE = /\.(?:otf|ttf|ttc|otc)$/iu;
const fontListPath = "FontList.ini";
const defaultFonts = new Set(["DefaultFont.ttf", "DefaultSubFont.ttf"]);
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const utf16 = new TextDecoder("utf-16be", { fatal: true });
const macRoman = new TextDecoder("macintosh");

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

export function fontNames(bytes) {
  return [
    ...new Set(
      [...fontDirectories(bytes)].flatMap(({ directory }) => {
        const table = fontNameTable(bytes, directory);
        return table ? namingTable(table) : [];
      }),
    ),
  ];
}

function absent(error) {
  if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
}

function fontListWithBom(content) {
  // Browser Woditor treats BOM-less text as CP932, including FontList.ini.
  return /[^\x00-\x7f]/u.test(content) && !content.startsWith("\uFEFF")
    ? `\uFEFF${content}`
    : content;
}

export async function browserFontEncodingUpdates(outputDir, pending) {
  const updates = new Map();
  const list =
    pending.get(fontListPath) ??
    (await readFile(join(outputDir, fontListPath)).catch(absent));
  if (list === undefined) return updates;
  let content;
  try {
    content = typeof list === "string" ? list : utf8.decode(list);
  } catch (error) {
    if (error instanceof TypeError) return updates;
    throw error;
  }
  const encoded = fontListWithBom(content);
  if (encoded !== content) updates.set(fontListPath, encoded);
  return updates;
}

export async function unpackBrowserFonts(archivePath, outputDir) {
  if (!(await stat(archivePath).catch(absent))?.isFile()) return [];
  try {
    const { files } = await unpackArchive(archivePath, outputDir, {
      includeFile: (name) => FONT_FILE.test(name),
    });
    return files ? await listFiles(outputDir) : [];
  } catch (error) {
    console.warn(`Could not read fonts from ${archivePath}: ${error.message}`);
    return [];
  }
}

export async function browserFontUpdates(
  outputDir,
  gameRoot,
  fontFiles,
  pending = new Map(),
) {
  const updates = new Map();
  const outputList = join(outputDir, fontListPath);
  const exportedList = await readFile(outputList).catch(absent);
  let list =
    pending.get(fontListPath) ??
    exportedList ??
    (await readFile(join(gameRoot, fontListPath)).catch(absent));
  if (list?.sourcePath) list = await readFile(list.sourcePath);
  // Preserve mappings, including their original spelling and order.
  let content;
  try {
    content = typeof list === "string" ? list : list ? utf8.decode(list) : "";
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
  for (const line of content.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
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
  for (const sourcePath of [...customRootFonts, ...fontFiles]) {
    const bytes = await readFile(sourcePath).catch(absent);
    if (!bytes) continue;
    for (const { directory, standaloneExtension } of fontDirectories(bytes)) {
      const nameTable = fontNameTable(bytes, directory);
      if (!nameTable) continue;
      const names = namingTable(nameTable).filter(
        (name) => !registered.has(name),
      );
      if (!names.length) continue;

      let filename = standaloneExtension
        ? undefined
        : published.get(sourcePath);
      if (!filename) {
        // Give each collection face its own file so names select the right face.
        const font = standaloneExtension
          ? extractFontFace(bytes, directory)
          : bytes;
        if (!font) continue;
        const hash = createHash("sha256")
          .update(font)
          .digest("hex")
          .slice(0, 16);
        const extension =
          standaloneExtension ?? extname(sourcePath).toLowerCase();
        filename = `assets/wolftools-font-${hash}${extension}`;
        updates.set(filename, standaloneExtension ? font : { sourcePath });
      }
      for (const name of names) {
        registered.add(name);
        additions.push(`${filename}=${name}`);
      }
    }
  }
  if (additions.length) {
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const separator = content && !content.endsWith("\n") ? newline : "";
    updates.set(
      fontListPath,
      fontListWithBom(content + separator + additions.join(newline) + newline),
    );
  } else if (fontListWithBom(content) !== content) {
    updates.set(fontListPath, fontListWithBom(content));
  } else if (list && !exportedList) {
    updates.set(fontListPath, list);
  }
  return updates;
}
