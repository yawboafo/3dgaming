# Placeholder asset sources

All placeholder art is CC0 1.0 (public domain). Crediting is optional; we credit anyway.
The files themselves are not committed (`assets/raw/` is gitignored); re-fetch them from the
sources below into the folders listed, then run `pnpm assets:build`.

| Folder under `assets/raw/` | Pack (version) | Source | Archive | What we kept |
| --- | --- | --- | --- | --- |
| `kenney-city-roads/` | Kenney City Kit (Roads) | <https://kenney.nl/assets/city-kit-roads> | `kenney_city-kit-roads.zip` (2.9 MB) | 95 GLB + `Textures/colormap.png` |
| `kenney-city-suburban/` | Kenney City Kit (Suburban) 2.0 | <https://kenney.nl/assets/city-kit-suburban> | `kenney_city-kit-suburban_20.zip` (3.0 MB) | 40 GLB + colormap |
| `kenney-cars/` | Kenney Car Kit 3.1 | <https://kenney.nl/assets/car-kit> | `kenney_car-kit.zip` (4.8 MB) | 50 GLB + colormap |
| `kenney-blasters/` | Kenney Blaster Kit 2.1 | <https://kenney.nl/assets/blaster-kit> | `kenney_blaster-kit_2.1.zip` (1.7 MB) | 40 GLB + colormap |
| `quaternius-characters/` | Quaternius Universal Base Characters (Standard, free) | <https://quaternius.itch.io/universal-base-characters> | `Universal Base Characters[Standard].zip` (129 MB) | Male/female full-body + 8 head-rigged hair/eyebrow meshes, packed glTF → GLB |
| `quaternius-anim/` | Quaternius Universal Animation Library (Standard, free) | <https://quaternius.itch.io/universal-animation-library> | `Universal Animation Library[Standard].zip` (16 MB) | `UAL1_Standard.glb` (43 clips) + root-motion variant |

Each folder keeps the pack's original `License.txt`.

## Notes

- Only the GLB (or glTF) exports were extracted; FBX/OBJ/Blend files were left in the archives.
- The Quaternius character glTFs reference two textures by the wrong name
  (`T_Hair_1_Normal_png.png`, `T_Eye_Normal_png.png`); the packed GLBs point at the files that
  ship (`T_Hair_1_Normal.png`, `T_Eye_Normal.png`).
- Characters and the animation library share one 65-joint rig, so `Idle_Loop`, `Walk_Loop`,
  `Jog_Fwd_Loop`, `Sprint_Loop`, `Jump_Start/Loop/Land`, `Driving_Loop` and `Pistol_*` clips apply
  to either body without retargeting.
- Quaternius' base textures include dark skin tones (`T_Superhero_*_Dark*`), which suit the
  art direction.
