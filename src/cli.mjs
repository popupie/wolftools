import { PACK_MODES } from "./constants.mjs";
import { formatInspection, inspectPath } from "./inspect.mjs";
import { packWolf } from "./pack.mjs";
import { unpackWolf } from "./unpack.mjs";
import { packageWolfGame } from "./web.mjs";

export function helpText() {
  return `Wolf Tools

Usage:
  wolftools inspect <game, folder, or archive>
  wolftools web <game or prepared release> [output folder] [runtime zip]
  wolftools unpack <game, folder, or archive> [output folder]
  wolftools pack <folder, game, or project> [mode] [output]
  wolftools modes
  wolftools help

The default pack mode is 2.20.

Use these commands only with games you own or are authorized to process.`;
}

function requireCount(command, values, minimum, maximum) {
  if (values.length < minimum || values.length > maximum) {
    throw new Error(`Wrong number of values for ${command}.\n\n${helpText()}`);
  }
}

export async function runCli(argv) {
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
    requireCount(command, values, 1, 3);
    const result = await packageWolfGame({
      sourceDir: values[0],
      outputDir: values[1],
      runtimeZipPath: values[2],
    });
    return `Created web export for ${result.title}.\nOutput: ${result.outputDir}`;
  }
  if (command === "unpack") {
    requireCount(command, values, 1, 2);
    const result = await unpackWolf({ sourcePath: values[0], outputDir: values[1] });
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
