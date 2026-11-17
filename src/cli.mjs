import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import packageJson from "../package.json" with { type: "json" };
import { PACK_MODES } from "./constants.mjs";
import { formatInspection, inspectPath } from "./inspect.mjs";
import { packWolf } from "./pack.mjs";
import { unpackWolf, unpackWolfInPlace } from "./unpack.mjs";
import {
  BROWSER_WODITOR_VERSION,
  inspectCombinedGame,
  packageWolfGame,
  resolveRuntimeVersion,
} from "./web.mjs";
import { serveWebExport } from "./serve.mjs";
import { migrateWebExport } from "./migrate.mjs";

const GLOBAL_OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

const OUTPUT_OPTION = { type: "string", short: "o" };
const COMMAND_OPTIONS = new Map([
  ["inspect", {}],
  [
    "web",
    {
      out: OUTPUT_OPTION,
      separate: { type: "string", short: "s" },
      runtime: { type: "string", short: "r" },
      "runtime-version": { type: "string" },
      migrate: { type: "boolean" },
    },
  ],
  ["serve", { port: { type: "string", short: "p" } }],
  ["unpack", { out: OUTPUT_OPTION }],
  ["pack", { out: OUTPUT_OPTION, mode: { type: "string", short: "m" } }],
  ["modes", {}],
  ["help", {}],
]);

export function helpText() {
  return `wolftools

Usage
  wolftools inspect <input>
  wolftools web <input> [--out <folder>] [--separate <true|false>] [--runtime-version <version>] [--runtime <zip>]
  wolftools web <input> --migrate [--runtime-version <version|default>] [--runtime <zip>]
  wolftools serve <input> [--port <number>]
  wolftools unpack <input> [--out <folder>]
  wolftools pack <input> [--out <path>] [--mode <mode>]
  wolftools modes
  wolftools help
  wolftools --version

Options
  -h, --help                   Show this help.
  -v, --version                Show the wolftools version.
  -o, --out <path>             Set the output path for web, unpack, or pack.
  -s, --separate <true|false>  Create a separate web export (default: true).
                               Use false to add web/ to the game and share Data/.
  -r, --runtime <zip>           Use a local ZIP for the selected Browser Woditor version.
      --runtime-version         Pin Browser Woditor for this export (tool default: ${BROWSER_WODITOR_VERSION}).
                                Use default to clear the export's pin.
  -m, --mode <mode>            Choose a WOLF RPG Editor pack mode.
  -p, --port <number>          Choose the server port (default: 4177).
      --migrate                Update an existing web export in place.`;
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

function requireCount(command, positionals, count) {
  if (positionals.length !== count || positionals.includes("")) {
    const expected = count === 1 ? "an input path" : "no positional arguments";
    throw new Error(`${command} expects ${expected}.\n\n${helpText()}`);
  }
}

function parseCommandArgs(args, commandOptions) {
  const { values, positionals, tokens } = parseArgs({
    args,
    options: { ...GLOBAL_OPTIONS, ...commandOptions },
    allowPositionals: true,
    tokens: true,
  });
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    const { name, rawName, inlineValue, value } = token;
    if (seen.has(name))
      throw new Error(`--${name} may only be specified once.`);
    seen.add(name);
    if (inlineValue && rawName.length === 2 && value.startsWith("=")) {
      values[name] = value.slice(1);
    }
    if (values[name] === "") throw new Error(`--${name} requires a value.`);
  }
  return { options: values, positionals };
}

export async function runCli(
  argv,
  {
    confirmExtraction = askToExtractArchives,
    write = (message) => process.stdout.write(message),
  } = {},
) {
  const [first = "help", ...rest] = argv;
  const global = first.startsWith("-");
  const command = global ? "help" : first;
  const commandOptions = COMMAND_OPTIONS.get(command);
  if (!commandOptions) {
    throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
  }

  const { options, positionals } = parseCommandArgs(
    global ? argv : rest,
    commandOptions,
  );
  if (options.version) return packageJson.version;
  if (options.help) return helpText();
  if (command === "help") {
    requireCount(command, positionals, 0);
    return helpText();
  }
  if (command === "modes") {
    requireCount(command, positionals, 0);
    return PACK_MODES.map((mode) => `${mode.name}  ${mode.label}`).join("\n");
  }

  requireCount(command, positionals, 1);
  const [input] = positionals;
  if (command === "inspect") {
    return formatInspection(await inspectPath(input));
  }
  if (command === "web") {
    const {
      out,
      runtime,
      separate: layout,
      migrate,
      "runtime-version": runtimeVersion,
    } = options;
    resolveRuntimeVersion(runtimeVersion);
    if (migrate) {
      if (out !== undefined || layout !== undefined) {
        throw new Error(
          "--migrate updates the export in place. Omit --out and --separate.",
        );
      }
      const result = await migrateWebExport({
        exportDir: input,
        runtimeVersion,
        runtimeZipPath: runtime,
      });
      const version = `${result.version} (Browser Woditor ${result.runtimeVersion})`;
      const output = `Output: ${result.outputDir}`;
      if (!result.migrated)
        return `Web export is already at version ${version}. No files were changed.\n${output}`;
      if (result.previousVersion === result.version)
        return `Updated web export runtime settings (Browser Woditor ${result.runtimeVersion}).\n${output}\n`;
      return `Migrated web export from version ${result.previousVersion} to ${version}.\n${output}\n`;
    }
    if (layout !== undefined && layout !== "true" && layout !== "false") {
      throw new Error("--separate must be true or false.");
    }
    const separate = layout !== "false";
    if (!separate) {
      const state = await inspectCombinedGame(input, { outputDir: out });
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
      sourceDir: input,
      outputDir: out,
      runtimeZipPath: runtime,
      runtimeVersion,
      separate,
    });
    return `Created web export for ${result.title}.\nOutput: ${result.outputDir}`;
  }
  if (command === "serve") {
    const result = await serveWebExport({
      rootDir: input,
      port: options.port,
    });
    return `Serving ${result.root}\nOpen: ${result.url}`;
  }
  if (command === "unpack") {
    const result = await unpackWolf({
      sourcePath: input,
      outputDir: options.out,
    });
    return `Unpacked ${result.files} files.\nOutput: ${result.outputDir}`;
  }
  if (command === "pack") {
    const result = await packWolf({
      sourcePath: input,
      modeName: options.mode,
      outputDir: options.out,
    });
    return `Created ${result.archives} archives with ${result.mode.label}.\nOutput: ${result.outputDir}`;
  }
}
