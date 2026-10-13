# App icon and featured icons

The mark is **"Crossed rackets and shuttle"**: two badminton rackets crossed in
an X (heads upper-left and upper-right, grips lower-right and lower-left,
crossing below centre) with a shuttlecock diving between the heads above the
crossing, cork pointing down. Flat, no gradients, no shadows, no text.
Kin to the app's stroke-built shuttlecock favicon in `public/index.html`.

Files (SVG sources next to the PNGs the platform serves):

| File | Size | Tile | Rackets | Skirt | Cork |
| --- | --- | --- | --- | --- | --- |
| `icon.svg` → `icon.png` | 1024×1024 | Black `#000000` | Cream `#FFFEEA` | Yellow `#FFEE6F` | Cream `#FFFEEA` |
| `featured-light.svg` → `featured-light.png` | 1600×1000 | Cream `#FFFEEA` | Black `#000000` | Yellow `#FFEE6F` with ~20-unit Black outline | Black `#000000` |
| `featured-dark.svg` → `featured-dark.png` | 1600×1000 | Black `#000000` | Cream `#FFFEEA` | Yellow `#FFEE6F` | Cream `#FFFEEA` |

Palette only: Black `#000000`, Cream `#FFFEEA`, Yellow `#FFEE6F` (the Homeroom
Black+Yellow and Cream+Black pairings; no other colour appears in any file).

## Geometry

Drawn on a 1024-unit grid; the featured files reuse the same mark via
`translate(364 110) scale(0.851)` so it sits at ~60% of the 1000-unit height,
centred.

- Head frames: ellipses rx 100, ry 140, stroke 46, rotated ±45°, centres
  (307, 348) and (717, 348).
- Shafts: stroke 46, from head rim to the crossing; grips: stroke 82
  (thicker), to (740, 772) / (284, 772). Round caps and joins throughout.
- Shuttle: skirt is a trapezoid with a convex rim arc (radius 80) at the top
  and a slight base arc (radius 35), from (455, 130) to (537/487, 252); cork
  is a circle r 40 at (512, 288).
- The mark keeps ~150 units of clear margin (inside the ~70% safe area):
  x from 162 to 862, y from 106 to 811 after the centring `translate(0 53)`.
- On the app icon, stroke 46 reads at ~1.4 px at a 32 px render — still
  legible (checked by rendering `icon.svg` at 32 px).

## Render command

Sources are hand-written SVG; PNGs are rendered with resvg (no rsvg-convert in
this environment):

```sh
npx --yes @resvg/resvg-js-cli brand/icon.svg brand/icon.png
npx --yes @resvg/resvg-js-cli brand/featured-light.svg brand/featured-light.png
npx --yes @resvg/resvg-js-cli brand/featured-dark.svg brand/featured-dark.png
```

The SVG viewBoxes already match the target sizes, so no fit flags are needed.

## How the app icon is wired

`dapp.json` points `icon.image` at `brand/icon.png` and keeps `icon.emoji`
(`🏸`) as the fallback; the image wins when present. The icon is committed as
`brand/icon.png` (kept out of the served folders, per platform convention).

The featured files are documentation/branding assets only: the platform has no
`dapp.json` field for featured icons yet, so nothing references
`featured-light.*` / `featured-dark.*`. If such a field appears, these are the
files for it.
