# IJP Patterner

Visual editor for **.ptn** pattern files produced by the Standalone Deposition Materials
Printer software (Dimatix-class inkjet deposition). Open a pattern, see exactly what the
machine will deposit, edit it with the mouse or the numeric fields, save it back.

```
npm install
npm run dev        # Vite + Electron with hot reload
npm start          # build once, run the packaged-style window
npm run verify     # round-trip every .ptn in the samples folder
npm run dist       # electron-builder → release/*.dmg (also dist:win)
```

## The file format

One-line XML, millimetres everywhere except `JetSpacing` (micrometres):

```xml
<PatternFile>
  <GeneralConfig>          print area, jet pitch, layers, leader bar
  <PatternBlock>           a tile: Left/Top/Width/Height + X/YSpacing + MaxX/YCount
    <Drop>                 StartX/StartY/XWidth/YHeight — one printed rectangle
```

New patterns start at the machine's **200 × 200 mm** print area: Film and Stage sizes are
typed as the print area, and the block is inset by one jet pitch so the area lands exactly
on the number you enter (a 200 × 200 area is a 199.99 × 199.99 block on 10 µm jets).

Two rules verified against all 42 sample files:

1. **Print area = block extent + one jet pitch.** `Width = max(block.Right) + JetSpacing/1000`,
   same for height. A 15 mm block at x = 4 on 10 µm jets is `19.01 × 1.215 mm`.
2. **The machine deposits rows, not vector fills.** A drop is rasterised into rows one
   `JetSpacing` apart, and a drop shorter than one jet still gets exactly one row. The
   `0.001 mm` "fingers" in the samples are really single 10 µm lines.

## Controls

| Action | How |
| --- | --- |
| Select several | ⇧-click toggles a drop in or out of the selection; ⇧-drag anywhere draws a selection box |
| Move a drop | drag it (snaps to grid, block/print-area edges, other drops' edges and centres) |
| Move a group | drag any selected drop — all of them move by the same snapped amount |
| Resize | drag a corner (or edge, when the drop is tall enough on screen) |
| Draw a new drop | drag inside a block's empty area |
| Pan | drag empty space, middle-drag, or hold Space and drag |
| Zoom | wheel (at cursor), ± buttons, `⌘0` to fit |
| Copy / cut / paste | `⌘C`, `⌘X`, `⌘V` — paste lands where the pointer is; `⇧⌘V` pastes in place |
| Delete / duplicate / copy | `Delete`, `⌘D`, `⌘C` act on the whole selection |
| Nudge | arrow keys (⇧ = 10×) |
| Free (unsnapped) drag | hold `⌥` |
| Design ↔ print raster | toolbar toggle, `⇧⌘R` |

**Snapping** is two independent switches. *Snap to grid* rounds to a step that defaults to
`auto` — the grid actually drawn at the current zoom, so a drag always lands on a visible
line (pin your own step in the field if you want exact numbers). *Snap to edges* pulls the
selection onto other drops' edges and centres, the block border and the print-area border,
with cyan guides showing what it caught. `⌥` suspends both for the duration of a drag.

## Pattern library and copying

`⌘L` opens the library: save the current pattern under a name, reopen it, delete it, or
**copy one/several/all patterns into any folder** you pick (the files are plain `.ptn`).
Library storage is `~/Library/Application Support/IJP Patterner/library` on macOS,
`%APPDATA%/IJP Patterner/library` on Windows; "Reveal folder" opens it.

## Importing SVG

`⇧⌘I`, the Library/Import row in the right panel, or just drop an `.svg` on the window.
The importer resolves transforms and converts:

- axis-aligned `<rect>` → one deposit (outline rectangles become four edge runs);
- `line`, `polyline`, `polygon`, `path`, `circle`, `ellipse` → sampled along the path at
  0.1 mm and emitted as thin deposits the width of the stroke, with straight horizontal
  and vertical runs merged back into single drops;
- filled non-rectangular shapes → their bounding box, with a warning.

Optionally rescale to a target width, then it becomes a normal pattern you can edit,
save and print.

## Layout

- `src/lib/ptn.ts` — reader/writer. Untouched numbers are re-emitted from their original
  text, so opening and saving a file untouched is **byte-identical**.
- `src/lib/geometry.ts` — raster model, tiling, print-area fitting, validation.
- `src/lib/snap.ts` — snap targets, box/edge snapping, guide lines.
- `src/lib/templates.ts` — Film, Fingers, Line, Stage, Blank generators.
- `src/components/Canvas.tsx` — SVG viewport: rulers, grid, drag/resize/draw, raster rows.
- `electron/main.cjs` — window, menus, open/save/export dialogs, Finder open-file.

## Verification

`npm run verify` bundles the real `ptn.ts`/`geometry.ts` with esbuild and checks every
sample: `42/42` byte-exact round-trips and `42/42` files satisfying the print-area rule,
plus all five templates building and re-parsing.
