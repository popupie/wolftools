import { createInterface } from "node:readline/promises";

import { PACK_MODES } from "./constants.mjs";
import { formatInspection, inspectPath } from "./inspect.mjs";
import { packWolf } from "./pack.mjs";
import { unpackWolf, unpackWolfInPlace } from "./unpack.mjs";
import { inspectCombinedGame, packageWolfGame } from "./web.mjs";
import { serveWebExport } from "./serve.mjs";
import { migrateWebExport } from "./migrate.mjs";

export function helpText() {
  return `wolftools

Usage:
  wolftools inspect <game folder, EXE, or archive>
  wolftools web <game folder or EXE> [output folder] [runtime zip] [--separate=true|false]
  wolftools web <export or combined game folder> --migrate
  wolftools serve <website or combined game folder> [port]
  wolftools unpack <game folder, EXE, or archive> [output folder]
  wolftools pack <folder, game, or project> [mode] [output]
  wolftools modes
  wolftools help

Web options:
  --separate=true   Create a new website folder. Do not change the game. (default)
  --separate=false  Add web/ to the game folder. Share its existing Data/ assets.
  --migrate         Update an existing export in place, preserving its settings and save identity.

Combined mode needs Game.exe or GamePro.exe and an unpacked Data/ folder.
If archives are found, wolftools asks before extracting them in the game folder.
This removes the archives and may break the game. Make a backup first.
Creating a new export stops with an error if the game already has web/.
Use --migrate to update an existing export instead.
Serve a combined game from its game folder, not only web/.

Examples:
  wolftools web "/path/to/Game" "./output/Web Game"
  wolftools web "/path/to/Game" --separate=false
  wolftools web "/path/to/Game/web" --migrate
  wolftools serve "/path/to/Game"

Pack detects the mode from Game.exe when possible. A plain folder uses 2.20.
WOLF RPG Editor Pro packing is not supported. The default server port is 4177.
Browser playback depends on the game and Browser Woditor.

Use these commands only with games you own or have permission to work with.`;
}

async function askToExtractArchives({ archives }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Archive extraction needs confirmation in an interactive terminal.",
    );
  }
  process.stdout.write(
    `\nThe game has ${archives.length} packed archive${archives.length === 1 ? "" : "s"}.\n` +
      "Combined mode needs unpacked archives. Extraction will make changes to the original game and removes the archives.\n" +
      "Warning: this may break the game, especially a Pro or protected game. Make a backup first.\n",
  );
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question("Extract the archives now? [y/N] ");
    return /^(?:y|yes)$/iu.test(answer.trim());
  } finally {
    prompt.close();
  }
}

function requireCount(command, values, minimum, maximum) {
  if (values.length < minimum || values.length > maximum) {
    throw new Error(`Wrong number of values for ${command}.\n\n${helpText()}`);
  }
}

function webArguments(values) {
  const positional = [];
  let separate = true;
  let migrate = false;
  let seen = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--migrate") {
      if (migrate) throw new Error("--migrate may only be specified once.");
      migrate = true;
    } else if (value === "--separate" || value.startsWith("--separate=")) {
      if (seen) throw new Error("--separate may only be specified once.");
      const raw =
        value === "--separate"
          ? values[++index]
          : value.slice("--separate=".length);
      if (raw !== "true" && raw !== "false")
        throw new Error("--separate must be true or false.");
      separate = raw === "true";
      seen = true;
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown web option: ${value}`);
    } else positional.push(value);
  }
  if (migrate && seen)
    throw new Error("Migration detects the existing layout. Omit --separate.");
  requireCount("web", positional, 1, migrate ? 1 : 3);
  return { positional, separate, migrate };
}

export async function runCli(
  argv,
  {
    confirmExtraction = askToExtractArchives,
    write = (message) => process.stdout.write(message),
  } = {},
) {
  const [command = "help", ...values] = argv;
  if (command === "help") return helpText();
  if (command === "modes") {
    return PACK_MODES.map((mode) => `${mode.name}  ${mode.label}`).join("\n");
  }
  if (command === "inspect") {
    requireCount(command, values, 1, 1);
    return formatInspection(await inspectPath(values[0]));
  }
  if (command === "web") {
    const { positional, separate, migrate } = webArguments(values);
    if (migrate) {
      const result = await migrateWebExport({ exportDir: positional[0] });
      return result.migrated
        ? `Migrated web export from version ${result.previousVersion} to ${result.version}.\nOutput: ${result.outputDir}\n`
        : `Web export is already at version ${result.version}. No files were changed.\nOutput: ${result.outputDir}`;
    }
    if (!separate) {
      const state = await inspectCombinedGame(positional[0]);
      if (state.needsExtraction) {
        if (!(await confirmExtraction(state)))
          return "Cancelled. No files were changed.";
        const extracted = await unpackWolfInPlace({
          sourcePath: state.sourceDir,
          archivePaths: state.archives,
        });
        write(
          `Extracted ${extracted.files} files and removed ${extracted.archives} archive${extracted.archives === 1 ? "" : "s"}.\n`,
        );
      }
    }
    const result = await packageWolfGame({
      sourceDir: positional[0],
      outputDir: positional[1],
      runtimeZipPath: positional[2],
      separate,
    });
    return `Created web export for ${result.title}.\nOutput: ${result.outputDir}`;
  }
  if (command === "serve") {
    requireCount(command, values, 1, 2);
    const result = await serveWebExport({
      rootDir: values[0],
      port: values[1] ?? 4177,
    });
    return `Serving ${result.root}\nOpen: ${result.url}`;
  }
  if (command === "unpack") {
    requireCount(command, values, 1, 2);
    const result = await unpackWolf({
      sourcePath: values[0],
      outputDir: values[1],
    });
    return `Unpacked ${result.files} files.\nOutput: ${result.outputDir}`;
  }
  if (command === "pack") {
    requireCount(command, values, 1, 3);
    const result = await packWolf({
      sourcePath: values[0],
      modeName: values[1],
      outputDir: values[2],
    });
    return `Created ${result.archives} archives with ${result.mode.label}.\nOutput: ${result.outputDir}`;
  }
  throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
}
