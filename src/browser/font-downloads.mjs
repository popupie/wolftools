import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import JSZip from "jszip";

import { FONT_CATALOG } from "./font-catalog.mjs";
import { browserFontUpdates, fontNames } from "./fonts.mjs";
import { checkGameFonts, reportGameFonts } from "./game-fonts.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const key = (name) => name.trim().normalize("NFC");

export function getFontCacheDir() {
  return join(homedir(), ".cache", "wolftools", "fonts");
}

function verify(bytes, file) {
  if (digest(bytes) !== file.sha256)
    throw new Error(`SHA-256 mismatch for ${file.filename ?? file.url}.`);
  return bytes;
}

async function download(file, fetchImpl) {
  const response = await fetchImpl(file.url, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status} downloading ${file.url}.`);
  return verify(Buffer.from(await response.arrayBuffer()), file);
}

async function atomicWrite(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function fontArchive(spec, cacheDir, fetchImpl, archives) {
  const key = `${spec.sha256}:${spec.filenameEncoding ?? "utf-8"}`;
  if (!archives.has(key))
    archives.set(
      key,
      (async () => {
        const directory = join(cacheDir, "archives");
        const path = join(directory, `${spec.sha256}.zip`);
        let bytes;
        try {
          bytes = verify(await readFile(path), spec);
        } catch (error) {
          if (
            !["ENOENT", "ENOTDIR"].includes(error.code) &&
            !error.message.startsWith("SHA-256 mismatch")
          )
            throw error;
          bytes = await download(spec, fetchImpl);
          await mkdir(directory, { recursive: true });
          await atomicWrite(path, bytes);
        }
        return JSZip.loadAsync(
          bytes,
          spec.filenameEncoding
            ? {
                decodeFileName: (value) =>
                  new TextDecoder(spec.filenameEncoding, {
                    fatal: true,
                  }).decode(value),
              }
            : {},
        );
      })(),
    );
  return archives.get(key);
}

function fontSource(font) {
  const lines = [
    `Source: ${font.source}`,
    ...(font.copyright ? [`Copyright: ${font.copyright}`] : []),
    `Font SHA-256: ${font.files[0].sha256}`,
    ...[font.archive?.url, ...font.files.map((file) => file.url)]
      .filter(Boolean)
      .map((url) => `Download: ${url}`),
  ];
  if (font.license === "IPA-1.0")
    lines.push(
      "License: IPA Font License Agreement v1.0 (see the accompanying license).",
      "Use of this font constitutes acceptance of that license.",
    );
  if (font.replacement)
    lines.push(
      "",
      "Replacing this derived font with its original IPA font:",
      `1. Download the original font from ${font.replacement.source}`,
      `   Original files: ${font.replacement.files.join(", ")}.`,
      "2. Copy the chosen original font into this web export (for example, assets/fonts/original-ipa/).",
      "3. In FontList.ini, change the file path before '=' on each affected mapping to the copied font path. Keep the requested name after '=' unchanged.",
      "4. Reload the game. The runtime will use the original IPA font for those mappings.",
      "The supplied font files are unmodified; the author's original replacement instructions are also included.",
    );
  return `${lines.join("\n")}\n`;
}

export async function loadCachedFont(
  font,
  {
    cacheDir = getFontCacheDir(),
    fetchImpl = globalThis.fetch,
    archives = new Map(),
  } = {},
) {
  const directory = join(
    cacheDir,
    `${font.id}-${font.files[0].sha256.slice(0, 16)}`,
  );
  let files;
  try {
    files = await Promise.all(
      font.files.map(async (file) =>
        verify(await readFile(join(directory, file.filename)), file),
      ),
    );
    console.log(`Using cached font: ${font.names[0]}`);
  } catch (error) {
    if (
      !["ENOENT", "ENOTDIR"].includes(error.code) &&
      !error.message.startsWith("SHA-256 mismatch")
    )
      throw error;
    console.log(`Downloading font: ${font.names[0]}`);
    const archive = font.archive
      ? await fontArchive(font.archive, cacheDir, fetchImpl, archives)
      : undefined;
    files = await Promise.all(
      font.files.map(async (file) => {
        if (!file.member) return download(file, fetchImpl);
        const members = Object.values(archive.files).filter(
          (entry) => !entry.dir && basename(entry.name) === file.member,
        );
        if (members.length !== 1)
          throw new Error(`Expected one ${file.member} in the font archive.`);
        return verify(await members[0].async("nodebuffer"), file);
      }),
    );
    // A matching checksum is required for every font and license file before
    // publishing anything into the shared cache.
    const names = new Set(fontNames(files[0]));
    if (!font.names.every((name) => names.has(key(name))))
      throw new Error(
        `Downloaded font does not contain the expected family names.`,
      );
    await mkdir(directory, { recursive: true });
    await Promise.all(
      font.files.map((file, index) =>
        atomicWrite(join(directory, file.filename), files[index]),
      ),
    );
  }
  return {
    fontPath: join(directory, font.files[0].filename),
    documents: font.files.slice(1).map((file) => ({
      filename: file.filename,
      sourcePath: join(directory, file.filename),
    })),
    source: fontSource(font),
  };
}

// Export/migration time only: the resulting website serves its own bundled
// fonts. Unrecognized names never trigger an Internet search or URL guess.
export async function requestedFontUpdates({
  pending = new Map(),
  catalog = FONT_CATALOG,
  cacheDir,
  fetchImpl,
  ...options
}) {
  const updates = new Map();
  const initial = await checkGameFonts({ ...options, pending, report: false });
  // Some weights share a family name. The first matching record is the default
  // a specific full/typographic family name still selects its exact variant.
  const wanted = [
    ...new Set(
      (initial?.missing ?? []).map((requested) =>
        catalog.find((font) =>
          font.names.some((name) => key(name) === requested),
        ),
      ),
    ),
  ].filter(Boolean);
  const archives = new Map();
  const downloaded = await Promise.all(
    wanted.map(async (font) => {
      try {
        return {
          font,
          ...(await loadCachedFont(font, { cacheDir, fetchImpl, archives })),
        };
      } catch (error) {
        console.warn(
          `Could not download WOLF font ${JSON.stringify(font.names[0])}: ${error.message}`,
        );
      }
    }),
  );
  const available = downloaded.filter(Boolean);
  if (available.length) {
    const staged = new Map(pending);
    // Remove broken registrations for the families we are repairing; leaving
    // duplicate names could make the runtime choose the old, missing file.
    const repaired = new Set(
      available
        .flatMap(({ font }) => font.names.map(key))
        .filter((name) => initial.missing.includes(name)),
    );
    let list = staged.get("FontList.ini");
    if (list?.sourcePath) list = await readFile(list.sourcePath);
    if (list === undefined) {
      try {
        list = await readFile(join(options.outputDir, "FontList.ini"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (list !== undefined) {
      let text = list;
      if (typeof text !== "string") {
        try {
          text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(list);
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          text = new TextDecoder("shift_jis", { fatal: true }).decode(list);
        }
      }
      staged.set(
        "FontList.ini",
        text
          .split(/(?<=\n)/u)
          .filter((line) => {
            const at = line.indexOf("=");
            return (
              at < 1 ||
              /^\s*[;#]/u.test(line) ||
              !repaired.has(key(line.slice(at + 1)))
            );
          })
          .join(""),
      );
    }
    for (const [path, value] of await browserFontUpdates(
      options.outputDir,
      options.outputDir,
      available.map(({ font, fontPath }) => ({
        sourcePath: fontPath,
        ...(font.preserveFilename
          ? {
              exportPath: `assets/fonts/${font.id}/${font.files[0].filename}`,
            }
          : {}),
        // Shared family names belong to their default variant, even when
        // only another weight's full name was requested for this export.
        names: font.names.filter(
          (name) =>
            catalog.find((candidate) =>
              candidate.names.some((alias) => key(alias) === key(name)),
            ) === font,
        ),
      })),
      staged,
    ))
      updates.set(path, value);
    for (const { font, documents, source } of available) {
      const directory = `assets/font-licenses/${font.id}`;
      for (const document of documents)
        updates.set(`${directory}/${document.filename}`, {
          sourcePath: document.sourcePath,
        });
      updates.set(`${directory}/SOURCE.txt`, source);
    }
  }
  const result = updates.size
    ? await checkGameFonts({
        ...options,
        pending: new Map([...pending, ...updates]),
        report: false,
      })
    : initial;
  reportGameFonts(result);
  return updates;
}
