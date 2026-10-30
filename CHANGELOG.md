# Changelog

## 0.1.0-alpha.0

First public release.

- ECS with SoA typed-array components, cached queries and recycled ids with generations.
- WebGL2 and WebGPU renderers behind one core: batching per (z, texture), y-sorted layers (radix sort), camera, screen layers, render interpolation.
- Sprites: spritesheets, animation, tint, alpha, flip; bitmap text from CSS fonts with accents and Nahuatl macrons.
- GPU particles (`renderer.burst`), tweens and timers, input (keyboard, pointer, multi-touch, gamepads), Web Audio.
- Scenes with hot reload, Tiled maps (orthogonal and isometric), devtools overlay.
- Rapier physics plugin (`@tlapalli/ollin/rapier`): fixed, dynamic and kinematic bodies.
- `npm create ollin` starter template.
