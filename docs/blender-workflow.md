# Blender → game workflow

How to get a model from Blender into the town. You need no code changes: export a `.glb`, drop it
in a folder, run one command, and point the asset manifest at it.

```
Blender ──export .glb──▶ assets/raw/town/<name>.glb ──pnpm assets:build──▶ assets/build/… + world/asset-bounds.json
                                                                              │
                                     world/assets.json (manifest) ◀─ --register / edit the url
```

The pipeline (`pnpm assets:build`) checks every file against the rules below, rejects the ones that
would break in game, and optimises the rest (meshopt geometry, KTX2 textures, joined meshes, GPU
instancing). Work in your own folder, `assets/raw/town/`. Conventions there are enforced as
**errors**; elsewhere they are warnings.

---

## 1. Scene setup

|                  |                                                                                                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Units**        | Metric, Unit Scale **1.0**. 1 Blender unit = 1 metre. A door is about 2.1 m, a person 1.8 m.                                                                                                                                                                   |
| **Up**           | Blender's +Z is up (the exporter converts it to glTF +Y).                                                                                                                                                                                                      |
| **Front**        | The model's front faces **−Y** in Blender (what you see from numpad 1, Front view). In game that's +Z, the direction everything faces at rotation 0.                                                                                                           |
| **Left / right** | Blender +X is the model's **left** side (the viewer's right in Front view). This matters for vehicles: the driver's side is +X.                                                                                                                                |
| **Origin**       | At ground level, centred on the footprint (bottom centre). Props are placed by their origin on a flat ground at y = 0. Exception: hand-held items and attachments (guns, hair, wheels). Put those origins where they attach: the grip, the head bone, the hub. |
| **Transforms**   | Apply rotation and scale (Ctrl+A ▸ All Transforms) before export. Object scale should be 1.                                                                                                                                                                    |

The pipeline catches the two classic mistakes: models 100× too large (exported in centimetres) or
too small (scale not applied). It also warns when the origin isn't on the model's base.

## 2. Export settings (File ▸ Export ▸ glTF 2.0)

Labels as in Blender 4.2 LTS.

| Section           | Setting                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Format            | **glTF Binary (.glb)**                                                                                         |
| Include           | **Selected Objects** (or Visible). Custom Properties off. Cameras and Punctual Lights off.                     |
| Transform         | **+Y Up** ✓                                                                                                    |
| Data ▸ Mesh       | **Apply Modifiers** ✓, UVs ✓, Normals ✓, Tangents only with normal maps, Vertex Colors off unless you use them |
| Data ▸ Material   | Materials: **Export**. Images: **Automatic** (PNG or JPEG are fine; the pipeline converts them).               |
| Data ▸ Shape Keys | Only if the asset animates them                                                                                |
| Data ▸ Armature   | Export Deformation Bones Only ✓ (characters)                                                                   |
| Data ▸ Skinning   | Include All Bone Influences **off** (4 per vertex is the GPU limit)                                            |
| Compression       | **Off.** The pipeline applies meshopt; Draco would be undone and redone.                                       |
| Animation         | Mode **Actions**. Always Sample Animations ✓. Export only the actions the asset needs.                         |

Save the export settings as an operator preset (the + next to the preset menu) so every export
matches.

## 3. Names and folders

- **File names:** lowercase kebab-case, `[a-z0-9-]`, e.g. `house-type-a.glb`, `market-stall.glb`,
  `hero-trotro.glb`. No spaces, capitals or underscores.
- **Folder:** `assets/raw/town/<category>/`, e.g. `town/buildings/`, `town/props/`,
  `town/vehicles/`, `town/characters/`. The folder path becomes part of the URL in the manifest.
- **`hero` in the name** (`hero-…`) keeps textures at 2048 px instead of 1024. Use it sparingly,
  for things the camera gets close to.
- **Object names inside the file** matter for three things only: collision proxies (`COL_…`),
  LODs (`…_LOD0`), and parts the game animates (wheels, below). Keep them tidy anyway; they show
  up in the pipeline report.

## 4. Collision proxies (`COL_`)

The game never collides with render meshes. Each solid asset gets simple boxes:

- Add a **cube** for each solid volume and name it **`COL_<anything>`** (`COL_walls`,
  `COL_counter`). Scale and move it to cover the volume. Rotation within the model is ignored, so
  keep proxies axis-aligned; the whole asset can still be rotated when placed.
- Use as few as possible. Usually 1–3 boxes: a house is one box, an L-shaped building two, a market
  stall one for the counter and nothing for the awning (players walk under it).
- Leave doorways open only if the building is enterable from the street. Interiors are separate
  rooms in Phase 0 (`world/interiors/`), so most buildings can be one solid box.
- Proxies are **removed from the rendered file** and stored in `world/asset-bounds.json`. The town
  generator uses them instead of one box around the whole model.

No `COL_` objects means the pipeline uses the model's bounding box, which is fine for crates and
simple props. Set `"collider": "none"` in the manifest for things you walk through (roads,
decals, bunting). Set `"trunk"` for poles and trees (a thin box up the middle).

## 5. Levels of detail (`_LOD0`, `_LOD1`, …)

Optional. For anything with a lot of geometry that is seen from far away (buildings, trees,
vehicles):

- Name the full-detail object **`<name>_LOD0`** and the reduced ones **`<name>_LOD1`**,
  **`<name>_LOD2`**, in the same file, on top of each other. Objects without a suffix (and `COL_`
  proxies) belong to every level.
- Aim for roughly **50 %** of the triangles per level (LOD1 ≈ ½, LOD2 ≈ ¼). Keep the silhouette
  and the material count; drop small details first.
- Levels must start at 0 and not skip (0, 1, 2; not 0, 2).
- The pipeline writes `name.glb` (LOD0) plus `name.lod1.glb`, `name.lod2.glb`. _The game draws
  LOD0 today. Distance-based switching will use these files when it lands._

## 6. Budgets

Checked on LOD0. Over budget is a warning in shared folders and an error in `town/`. Per-folder
budgets live in `assets/pipeline.json`.

|                                      | Triangles | Materials | Textures                     |
| ------------------------------------ | --------- | --------- | ---------------------------- |
| Props, buildings, vehicles (default) | ≤ 8,000   | ≤ 4       | ≤ 1024 px (2048 for `hero-`) |
| Characters                           | ≤ 20,000  | ≤ 4       | ≤ 1024 px                    |

- **Materials are draw calls.** Prefer one material with a shared palette or atlas texture. The
  Kenney kits use a single `colormap.png` for everything, which is why the whole town fits in about
  60 draw calls.
- **Textures:** powers of two (256, 512, 1024, 2048). Anything larger is resized. Low-poly
  stylised art rarely needs normal or roughness maps; flat colour and baked AO read best.
- **The whole game targets ≤ 15 MB initial download** and ≤ 300 draw calls a frame. Today it's
  about 2.8 MB and 130–220 draw calls, so there's room, but it goes quickly with many materials.

## 7. Art direction

Low-poly, stylised, warm West-African coastal town: sun-bleached plaster in ochre, terracotta,
lime and sea-blue; corrugated roofs; hand-painted signboards; kiosks, chop bars, provisions
stores, barbering salons; palms and neem trees toward the beach to the south. Flat-shaded or
lightly smoothed; no PBR realism. The sun is warm and low, so strong silhouettes and roof
overhangs pay off.

## 8. Characters

The game animates characters with a shared clip library. To work with it, a character must use
the **same skeleton** as the placeholder (Quaternius Universal Base Characters, Unreal-mannequin
bone names, 65 joints). Key names include `root`, `pelvis`, `spine_01…03`, `Head`, `hand_l`,
`hand_r` and the finger bones `index_01_r`, `middle_01_r`, `thumb_01_r`.

- Easiest route: import the placeholder
  (`assets/raw/quaternius-characters/Superhero_Male_FullBody.glb`) into Blender, skin your mesh to
  its armature, and keep the bone names. (The free Quaternius tier ships glTF only; there's no
  `.blend`.)
- **Hand:** the gun attaches to `hand_r`. Its alignment is computed from the bind pose: the barrel
  follows the fingers (`index`/`middle`) and the top faces the thumb. Keep a natural T-pose with
  palms down and thumbs forward.
- **Animation clips** the game plays, by name (from `apps/client/src/game/characterView.ts`):
  `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`, `Jump_Loop`, `Driving_Loop`,
  `Death01`, `Pistol_Idle_Loop`, `Pistol_Aim_Neutral`. Root motion is ignored: the game keeps the
  hips' height (so sitting and bobbing work) and drops the horizontal travel.
- Small face meshes (eyes, brows) are dropped on crowd pedestrians if their object names contain
  `eye` or `brow`. Name them that way.
- Characters face −Y in Blender like everything else, feet on the ground at the origin.

## 9. Vehicles

- Separate objects for the body and each wheel, named exactly `wheel-front-left`,
  `wheel-front-right`, `wheel-back-left`, `wheel-back-right` (left = Blender +X). Each wheel's
  origin at its hub; the wheel spins about its X axis.
- Keep wheels as separate objects. Don't join them. The `kenney-cars/` rule in
  `assets/pipeline.json` stops the optimiser merging them; add the same rule for your vehicle
  folder.
- Handling (mass, suspension, engine, seat and exit points, wheel positions for physics) lives
  in `world/vehicles.json`. Point a kind's `model.asset` at your manifest id and adjust `wheels[].pos`
  to your hubs (in metres, model space).

## 10. Replacing a placeholder

1. Export to `assets/raw/town/<category>/<name>.glb`.
2. Run the pipeline:
   ```bash
   pnpm assets:build
   ```
   Read the report. `✗` lines are rejected files (fix and re-export). `!` lines are warnings. A clean
   file prints nothing.
3. Point the game at it. Either:
   - **Replace:** in `world/assets.json`, change the existing id's `url` (e.g. `"house-a"`) to
     `"town/buildings/<name>.glb"` and set `"scale": 1`. Every house of that type in town now
     uses your model.
   - **Add new:** run `pnpm assets:build -- --register` to add an entry (id = file name) for every
     new file, then use the id in the town layout.
4. If the footprint or collision changed, regenerate the town so colliders match:
   ```bash
   pnpm town:gen
   ```
5. `pnpm dev` and look at it. `http://localhost:5173/debug` shows draw calls and download size.

Commit the `.glb` source only if the team agrees (`assets/raw/` is git-ignored by default). Always
commit `world/assets.json`, `world/asset-bounds.json` and `world/town.json`.

## 11. Checklist before export

- [ ] Scale applied, 1 unit = 1 m, origin at bottom centre (or at the attach point)
- [ ] Front faces −Y, left is +X
- [ ] File name lowercase-kebab-case; saved in `assets/raw/town/<category>/`
- [ ] `COL_` boxes cover the solid parts (or the bounding box is good enough)
- [ ] LODs named `_LOD0…` if any, no gaps
- [ ] Within budget: triangles, ≤ 4 materials, power-of-two textures
- [ ] Characters: placeholder skeleton and bone names, T-pose bind; clips named as above
- [ ] Vehicles: separate wheel objects with the exact names, hubs at their origins
- [ ] Export preset: glb, +Y up, apply modifiers, no compression

## Troubleshooting

| Report says                                             | Fix                                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `largest dimension is 400 m — exported in centimetres?` | Scene ▸ Units ▸ Unit Scale 1.0, apply scale, re-export                                             |
| `scale not applied?`                                    | Ctrl+A ▸ Scale on the object                                                                       |
| `origin is 1.20 m from the model's base`                | Set origin: Object ▸ Set Origin, or move the mesh in Edit Mode so its base is at z = 0             |
| `collision proxy "COL_x" has no mesh`                   | Make it a mesh cube, not an Empty                                                                  |
| `LOD levels skip from 0 to 2`                           | Rename to `_LOD1`                                                                                  |
| `N materials (budget 4)`                                | Merge materials onto a shared palette or atlas                                                     |
| `texture … is 1000×1000; use powers of two`             | Resize to 1024×1024                                                                                |
| Model faces backwards in game                           | Front must face −Y in Blender; rotate 180° about Z and apply                                       |
| Gun points the wrong way in the hand                    | Check the rig's T-pose (palms down, thumbs forward). Fine-tune `model.rot` in `world/weapons.json` |
