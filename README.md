# wolftools (WIP)

wolftools is a command line tool for WOLF RPG Editor games. It can check game
files, unpack supported archives, pack folders into archives, and create a
website with Browser Woditor.

Use wolftools only with games you own or have permission to work with.

## Choose a command

- `inspect` shows the game version and archive details it can detect.
- `unpack` extracts archive files into a new folder.
- `pack` creates archives from folders.
- `modes` shows all supported pack modes.
- `web` creates a [Browser Woditor](https://frostyhowl.com/browser-woditor/) website.
- `serve` starts a local web server for testing/playing.

## Install

wolftools needs Node.js 22 or newer and pnpm 10 or newer.

Install dependencies:

```sh
pnpm install
```

Make the `wolftools` command available on your computer:

```sh
pnpm link -g
```

Use `--help` to see available commands and `--version` to check the installed
wolftools version.

```sh
wolftools --help
wolftools --version
```

The short forms are `-h` and `-v`.

## Inspect

Check a game folder, `Game.exe`, `GamePro.exe`, or an archive:

```sh
wolftools inspect "/path/to/Game"
```

The report shows the versions, archive types, and encryption modes it can
detect. It also shows whether wolftools supports the archive format.

## Create a website version

### Create a separate copy

By default, `web` creates a new folder and does not change the original game:

```sh
wolftools web "/path/to/Game" --out "./output/Web Game"
```

The default is `--separate true`. If you omit `--out` (`-o`), the tool adds
` web` to the game folder's name.

wolftools finds `Game.exe` or `GamePro.exe` and extracts supported archives.
It accepts a game with a `Data/` folder or a `Data.wolf` archive.

If `Game.ini` is missing, the tool creates a default one for the website.

For exports with unpacked assets, wolftools puts existing files named by literal
`GET_FILE_EXIST` checks into the browser's startup `Data.wolf`. Paths assembled at runtime or stored in
encrypted event data may need to be packed manually.

### Share one game folder

Use `--separate false` or `-s false` to keep the Windows EXE and website in the
same game folder.

```sh
wolftools web "/path/to/Game" --separate false
wolftools serve "/path/to/Game"
```

This adds a `web/` folder. The EXE and browser both use the existing `Data/`
folder. If you pass `--out` in when `--separate false`, it must point to the game's
`web/` folder.

Combined mode needs unpacked archives in `Data/`. If the game still uses archives,
wolftools asks if you want to extract them. The default answer is no.

If you answer yes, wolftools extracts the files into the original game folder
and removes the packed archives. This changes the original game. It may break
some games, especially Pro games and games with custom protection. Make a
backup before you agree. Automatic extraction stops if it would overwrite an
existing file or folder.

### Migrate an existing web export

Use `--migrate` to update an existing export in place.

```sh
wolftools web "/path/to/Web Game" --migrate
```

For a combined export, pass either the game folder or its `web/` folder:

```sh
wolftools web "/path/to/Game" --migrate
```

Existing browser saves remain accessible in the same browser profile at the same website origin
(protocol, hostname and port) and page path.

See update detail [here](#web-export-version)

### Choose a Browser Woditor version

The default version is 0.6.3.0. Supported pins are 0.6.3.0, 0.6.2.0, and
0.4.1.0. Use `--runtime-version` when a game needs a specific version:

```sh
wolftools web "/path/to/Game" --separate false --runtime-version 0.4.1.0
wolftools web "/path/to/Existing Game" --migrate --runtime-version 0.4.1.0
```

Future migrations keep an export's pin. To clear it and install the tool's
default version, use `--migrate --runtime-version default`.

Switching to or from 0.4.1.0 replaces the runtime's HTML template and applies
the wolftools layout and asset loader to the new template. Keep a copy of any
custom changes to `index.html`. The export keeps its browser save identity.
An older engine may be unable to read a save created by a newer engine.

New wolftools exports using 0.4.1.0 fetch and decode eligible loose audio
asynchronously. Run `--migrate` to update the loader on an older export pinned
to 0.4.1.0.

Pass `--runtime` (`-r`) to use a local copy of the selected version's ZIP.
wolftools verifies its checksum.

```sh
wolftools web "/path/to/Existing Game" --migrate --runtime-version 0.4.1.0 --runtime "/path/to/BrowserWoditor_0_4_1_0.zip"
```

### Test the website

For a web export:

```sh
wolftools serve "./output/Web Game"
```

The server prints the link to open and uses port `4177` by default. Use
`--port` (`-p`) to choose a different port.
Click or tap the game screen once to let the browser start audio and the game.

## Unpack

Unpack one archive:

```sh
wolftools unpack "/path/to/BasicData.wolf" --out "./output/BasicData"
```

Unpack the archives found through a game executable:

```sh
wolftools unpack "/path/to/Game.exe" -o "./output/Unpacked Game"
```

If you omit `--out`, wolftools creates a sibling folder named after the input
with ` unpacked` appended.

These standard WOLF archive formats are supported. This table does not mean
that Pro packing is supported.

| Standard editor family | Archive format          | Pack | Unpack |
| ---------------------- | ----------------------- | ---- | ------ |
| 2.00-2.10              | DX5                     | Yes  | Yes    |
| 2.20                   | DX6                     | Yes  | Yes    |
| 2.225-2.296            | DX8 classic             | Yes  | Yes    |
| 3.00-3.139             | DX8 classic             | Yes  | Yes    |
| 3.14-3.30              | DX8 classic             | Yes  | Yes    |
| 3.31-3.49              | DX8 modern encryption   | Yes  | Yes    |
| 3.50+ archive family   | DX8 modern encryption   | Yes  | Yes    |
| ChaCha2 variants       | DX8 ChaCha20 encryption | Yes  | Yes    |

Support includes encrypted archive tables, file keys, LZ compression, Huffman
compression, and partial Huffman compression.

Pro archives need their matching key archive beside them. wolftools supports
legacy Pro, Pro ChaCha2, and supported Pro 3.x key formats. You can pass a game
folder, `GamePro.exe`, or a data archive with its key file nearby. Common key
archive names include `Game`, `List`, `Data2`, `GameFile`, and `BasicData2`.

Pro archive packing is not available. wolftools can unpack the archive layer
of supported Pro releases when the matching key archive is present. It cannot
remove separate protection from files stored inside a Pro archive. A custom or
new Pro format may not work.

## Pack

Pack one folder into one archive:

```sh
wolftools pack "/path/to/BasicData" --out "./output/BasicData.wolf"
```

Choose another pack mode with `--mode` (`-m`). Run `wolftools modes` to list
supported modes.

```sh
wolftools pack "/path/to/BasicData" --mode 3.50
```

Pack the folders inside a game's `Data/` folder:

```sh
wolftools pack "/path/to/Game Project"
```

For a standard game folder, the tool needs `Game.exe` and a `Data/` folder with
subfolders. It makes one archive for each subfolder. The original game is not
changed. wolftools reads the editor version from `Game.exe` and chooses the
matching pack mode when possible. If the version cannot be read, it uses
`2.20`. A plain folder without `Game.exe` also uses `2.20` unless you give a
mode. If you omit `--out`, a plain folder produces a sibling `.wolf` archive
and a game project produces a sibling folder with ` packed` appended.

Packing a Pro game is not supported. The tool stops if the game uses
`GamePro.exe`.

## Privacy and licenses

Game files stay on your computer. wolftools does not upload them.

[Browser Woditor](https://frostyhowl.com/browser-woditor/) is a separate project with its own license and usage rules.
Its runtime files are not included in this repository.

## Notes

- This is an unofficial player for user provided web game exports. It is not
  affiliated with or endorsed by SmokingWOLF.
- This project is a work in progress. The source code structure, features, and
  supported formats may change over time. The approach to
  [privacy](#privacy-and-licenses) will remain unchanged.

## Web export version

- `2026.11.17.4`: Packs assets found by literal `GET_FILE_EXIST` checks into the browser startup archive.
- `2026.11.17.3`: Enables asynchronous audio loading on Browser Woditor 0.4.1.0.
- `2026.11.17.2`: Supports selecting and retaining a Browser Woditor version.
- `2026.11.17.1`: Updates Browser Woditor to 0.6.3.0.
- `2026.11.17`: Keeps the canvas at native size or smaller in a normal window.
- `2026.11.04`: Fix Chromium MP3 loading failures with asynchronous.
