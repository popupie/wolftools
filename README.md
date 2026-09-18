# Wolf Tools

Wolf Tools is a standalone command line tool for WOLF RPG Editor games. It can
inspect WOLF files, prepare a Browser Woditor website, unpack supported archives,
and create supported archives.

## Use Case

WOLF RPG Editor creates Windows games. Browser Woditor provides the WebAssembly
runtime needed to run a compatible creator export in a browser.

Wolf Tools brings the related tasks into one command.

Use Wolf Tools only with a game you own or are authorized to process.

## App Flow

1. Install Wolf Tools.
2. Inspect a game or archive when you need format information.
3. Use web with a native game or Browser Woditor ready creator release.
4. Use unpack to extract supported archives into a new folder.
5. Use pack to create a release with supported WOLF archives.

## Install

Wolf Tools needs Node.js 22 or newer and pnpm 10 or newer.

Install dependencies:

```sh
pnpm install
```

Make the command available on your computer:

```sh
pnpm link -g
```

Show command help:

```sh
wolftools help
```

## Inspect

Inspect a game folder, executable, or archive:

```sh
wolftools inspect "/path/to/Game"
```

The report shows detected executables, archive headers, DX archive versions,
known encryption modes, and whether the archive has native support.

## Export to a Website

Create a website directly from a game folder:

```sh
wolftools web "/path/to/Game" "./output/Web Game"
```

Wolf Tools finds `Game.exe` or `GamePro.exe`, unpacks the supported WOLF
archives, adds the Browser Woditor marker, and writes the game files into the
website. It accepts games with a Data folder and games with one `Data.wolf`
beside the executable. If an older game has no `Game.ini`, Wolf Tools creates a
safe default for the browser export. The original game is not changed.

Native games use asset by asset loading. The website has a small `Data.wolf`
startup archive containing only the Browser Woditor marker. Maps, images,
audio, and game databases are separate files under `Data`. Wolf Tools adds a
manifest and a loader that gives Browser Woditor each file when the game first opens it.

This avoids downloading the complete game at startup. A file can cause a short
pause the first time the game needs it, especially for large audio or video.
The browser cache can reuse downloaded files on later visits.

For offline use, add the path to a Browser Woditor ZIP as the third value:

```sh
wolftools web "/path/to/Game" "./output/Web Game" "/path/to/BrowserWoditor.zip"
```

## Unpack

Unpack one archive:

```sh
wolftools unpack "/path/to/BasicData.wolf" "./output/BasicData"
```

Unpack the archives found through a game executable:

```sh
wolftools unpack "/path/to/Game.exe" "./output/Unpacked Game"
```

Wolf Tools supports packing and unpacking native DX version 6 archives created
with WOLF RPG Editor 2.20. This includes encrypted archives and compressed file
data.

Unpack also supports standard DX version 8 archives compatible with WOLF RPG
Editor 2.281, 3.10, and 3.173. It handles encrypted and compressed archive
tables, individual file keys, LZ data, Huffman data, and partial Huffman data.
It also accepts the clear DX version 8 archives created by the Web command.
Windows, macOS, and Linux use the same JavaScript implementation.

## Pack

Pack one folder into one archive:

```sh
wolftools pack "/path/to/BasicData" 2.20 "./output/BasicData.wolf"
```

Pack the subfolders inside a project Data folder:

```sh
wolftools pack "/path/to/Game Project" 2.20 "./output/Packed Game"
```

The input folder needs `Game.exe` or `GamePro.exe` and a Data folder. The
original project is not changed. The default mode is `2.20`.

Show all supported pack modes:

```sh
wolftools modes
```

When the input is a game project, Pack creates one archive for each subfolder
inside Data. Use the official WOLF RPG Editor Create Game Data feature when you
need its complete desktop release workflow. The Web command creates the small
startup archive and separate browser assets required for loading files as the
game needs them.

## Privacy

Game files stay on your computer. Wolf Tools does not upload them.

Browser Woditor is downloaded from its official project site when required. A
checksum is verified before it is used. Pack and unpack do not use the network.

## Notes

Browser Woditor is a separate project with its own license and usage
guidelines. Its runtime files are not included in this repository.

Archive compatibility depends on the WOLF RPG Editor version and encryption
mode. Some WOLF 3 releases, WOLF Pro releases, and games with custom protection
use a different crypt format.
