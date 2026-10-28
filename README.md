# wolftools (WIP)

wolftools is a command line tool for WOLF RPG Editor games. It can check game
files, unpack supported archives, pack folders into archives, and create a
website with Browser Woditor.

Use wolftools only with games you own or have permission to work with.

## Choose a command

- `inspect` shows the game version and archive details it can detect.
- `web` creates a [Browser Woditor](https://frostyhowl.com/browser-woditor/) website.
- `unpack` extracts archive files into a new folder.
- `pack` creates archives from folders.
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

Show command help:

```sh
wolftools help
```

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
wolftools web "/path/to/Game" "./output/Web Game"
```

This is the same as using `--separate=true`. If you leave out the output path,
the tool adds ` web` to the game folder's name.

wolftools finds `Game.exe` or `GamePro.exe` and extracts supported archives.
It accepts a game with a `Data/` folder or a `Data.wolf` archive.

If `Game.ini` is missing, the tool creates a default one for the website.

### Share one game folder

Use `--separate=false` to keep the Windows EXE and website in the same game
folder:

```sh
wolftools web "/path/to/Game" --separate=false
wolftools serve "/path/to/Game"
```

This adds a `web/` folder. The EXE and browser both use the existing `Data/`
folder.

Combined mode needs unpaced archives in `Data/`. If the game still uses archives,
wolftools asks if you want to extract them. The default answer is no.

If you answer yes, wolftools extracts the files into the original game folder
and removes the packed archives. This changes the original game. It may break
some games, especially Pro games and games with custom protection. Make a
backup before you agree. Automatic extraction stops if it would overwrite an
existing file or folder.

If the game folder already contains `web/`, the command stops and does not
overwrite it.

### Use a local Browser Woditor ZIP

To use a ZIP you already downloaded, add its path as the third value:

```sh
wolftools web "/path/to/Game" "./output/Web Game" "/path/to/BrowserWoditor.zip"
```

For combined mode:

```sh
wolftools web "/path/to/Game" "/path/to/Game/web" "/path/to/BrowserWoditor.zip" --separate=false
```

### Test the website

For a web export:

```sh
wolftools serve "./output/Web Game"
```

The server returns the link to open. Copy and paste it in the URL address bar.
Click or tap the game screen once to let the browser start audio and the game.

## Unpack

Unpack one archive:

```sh
wolftools unpack "/path/to/BasicData.wolf" "./output/BasicData"
```

Unpack the archives found through a game executable:

```sh
wolftools unpack "/path/to/Game.exe" "./output/Unpacked Game"
```

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
wolftools pack "/path/to/BasicData" 2.20 "./output/BasicData.wolf"
```

Choose another supported version:

```sh
wolftools pack "/path/to/BasicData" 3.50 "./output/BasicData.wolf"
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
mode.

Packing a Pro game is not supported. The tool stops if the game uses
`GamePro.exe`.

Show all supported pack modes:

```sh
wolftools modes
```

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
