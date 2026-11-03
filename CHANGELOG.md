# Changelog

## 0.1.0-alpha.1

- Tilemaps: `map.tileAt(layer, x, y)` finds the tile under a world point (diamond cells on isometric maps), and
  `map.cellAt`, `map.cellCenter`, `map.cols`, `map.rows` convert between world points and cells for grid logic and
  pathfinding.
- Tiled horizontal and vertical tile flips become `Sprite.flipX`/`flipY`.
- A `Sprite` without a texture is a solid rectangle in its tint (texture 0 is now a built-in white pixel), for panels,
  bars and fades. Loaded textures start at id 1.
- Doc comments on every public export, published as the API reference at https://tlapalli.github.io/docs/api/readme/.
- New example games: `examples/ocelotl` (isometric waves, flow-field pathfinding) and `examples/mictlan` (side-scrolling
  action platformer with a boss).

## 0.1.0-alpha.0

First public release.

- ECS with SoA typed-array components, cached queries and recycled ids with generations.
- WebGL2 and WebGPU renderers behind one core: batching per (z, texture), y-sorted layers (radix sort), camera, screen layers, render interpolation.
- Sprites: spritesheets, animation, tint, alpha, flip; bitmap text from CSS fonts with accents and Nahuatl macrons.
- GPU particles (`renderer.burst`), tweens and timers, input (keyboard, pointer, multi-touch, gamepads), Web Audio.
- Scenes with hot reload, Tiled maps (orthogonal and isometric), devtools overlay.
- Rapier physics plugin (`@tlapalli/ollin/rapier`): fixed, dynamic and kinematic bodies.
- `npm create ollin` starter template.
