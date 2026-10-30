# Ollin guide

How each part of Ollin works, with the code to use it. New here? Start with [Getting started](./getting-started.md). Every function also has documentation in its type definitions, so your editor shows it on hover.

- [The game, plugins and resources](#the-game-plugins-and-resources)
- [Entities, components and queries](#entities-components-and-queries)
- [Systems and stages](#systems-and-stages)
- [Scenes](#scenes)
- [Sprites](#sprites)
- [Drawing order, 2.5D and screen layers](#drawing-order-25d-and-screen-layers)
- [Camera](#camera)
- [Text](#text)
- [Assets](#assets)
- [Input](#input)
- [Tweens and timers](#tweens-and-timers)
- [Particles](#particles)
- [Collisions](#collisions)
- [Physics with Rapier](#physics-with-rapier)
- [Tiled maps](#tiled-maps)
- [Audio](#audio)
- [Devtools](#devtools)
- [WebGL2 and WebGPU](#webgl2-and-webgpu)
- [Performance](#performance)

## The game, plugins and resources

```ts
import { audio, createGame, devtools, input, webgl2 } from 'ollin'
import { rapier } from 'ollin/rapier'

const game = await createGame({ canvas, plugins: [webgl2(), input(), audio(), rapier()] })
```

A plugin is a function `(game) => void` (or `async`). It registers **resources** (the renderer, the input state, the physics world) and **systems**. Get a resource with its token:

```ts
const renderer = game.get(Renderer)
const input = game.get(Input)
```

Your own shared things work the same way, with a typed token instead of a string key:

```ts
const Score = token<{ value: number }>('Score')
game.set(Score, { value: 0 })
game.get(Score).value++
```

`createGame` options: `capacity` (initial entity capacity, default 16,384; the world doubles it when full) and `fixedDt` (seconds per fixed step, default 1/60).

## Entities, components and queries

```ts
const Velocity = defineComponent({ x: f32, y: f32 })
const Health = defineComponent({ hp: u16, max: u16 }, { hp: 3, max: 3 }) // with defaults

const e = world.spawn([Position, { x: 10, y: 20 }], [Velocity, { x: 50 }], [Health])
world.add(e, Rotation, { angle: Math.PI / 4 })
world.remove(e, Velocity)
world.has(e, Health) // true
world.despawn(e)
```

Components store each field as a typed array indexed by entity (`Position.x[e]`). This is what makes Ollin fast: a system walks plain number arrays, which the browser can process quickly and hand straight to the GPU. Field types: `f32`, `f64`, `i32`, `u8`, `u16`, `u32`.

`world.spawn` takes `[Component, values]` pairs, so TypeScript catches a misspelled field.

A query is the live list of entities that have all the given components. It is cached and kept up to date as entities change, so call `world.query` once, outside your systems:

```ts
const moving = world.query(Position, Velocity)
game.system((dt) => {
  for (const e of moving.entities) Position.x[e] += Velocity.x[e] * dt
})
```

Rules worth knowing:

- **Read component arrays inside systems.** `const { x } = Position` is fine at the top of a system, but not in your scene setup or at module level. When the world outgrows its capacity, the arrays are replaced with bigger ones, and a saved copy goes stale. It then reads as empty, so the bug shows up as sprites vanishing.
- **Loop backwards when you despawn while iterating.** Despawning moves the last entity of the query into the freed slot.
- **Entity ids are reused.** If you keep an entity id across frames (a target, a tween), the entity may have been despawned and its id given to a new one. Save `world.generation(e)` and compare it later; `tween` does this for you.

Built-in components: `Position` (`x`, `y`, `z`), `Rotation` (`angle`, radians), `Sprite`, `Animation` and `Particle`.

## Systems and stages

```ts
game.system((dt) => { /* every frame */ })            // 'update' stage
game.system((dt) => { /* fixed rate */ }, 'fixed')    // physics, deterministic logic
const stop = game.system(fn)                          // returns a function that removes it
```

Each frame runs `fixed` systems as many times as needed to keep a steady rate (`game.fixedDt`, 1/60 s by default), then `update` and `render` once. Put physics and anything that must behave the same at any frame rate in `fixed`; everything else goes in `update`.

## Scenes

A scene is a function that sets up a level, a menu or a screen. It may be `async`, and it may return a cleanup function for anything outside the engine (DOM listeners, for example).

```ts
const menu: Scene = async (game) => {
  // load, spawn, add systems...
  game.system(() => {
    if (game.get(Input).pressed.has('Space')) void game.scene(level(1))
  })
}

// Scenes with parameters are functions that return a scene.
const level = (n: number): Scene => async (game) => { /* ... */ }

await game.scene(menu)
```

`game.scene(next)` despawns every entity, removes the systems, tweens and timers the current scene added, runs its cleanup, and then runs `next`. Plugins and their resources stay. To restart a level, call `game.scene` with the same scene again.

For hot reload, put scenes in their own module and add one line to your entry file. Saving the module restarts the scene in place:

```ts
import.meta.hot?.accept('./level', (m) => m && game.scene(m.level))
```

Loaders cache by URL, so restarting a scene does not download or upload its assets again.

## Sprites

```ts
world.spawn(
  [Position, { x: 100, y: 100, z: 1 }],
  [Sprite, { w: 32, h: 32, texture: textures.hero, frame: 0, tint: 0xffffff, alpha: 1, flipX: 0, flipY: 0 }],
)
```

- The sprite is centered on `Position` and rotated by `Rotation` if the entity has it.
- `frame` picks a cell of a spritesheet (see [Assets](#assets)), counting left to right, top to bottom.
- `tint` multiplies the image by a color (`0xRRGGBB`). On white art you get exactly that color; on colored art it darkens. Draw things you want to recolor in white or gray.
- `alpha` fades from 0 (invisible) to 1. `flipX` and `flipY` mirror the image, e.g. to face a character left. They cost nothing.

**Animation** plays frames of a spritesheet:

```ts
world.spawn([Position], [Sprite, { w: 32, h: 48, texture: textures.walker }], [Animation, { start: 0, count: 4, fps: 8 }])
Animation.fps[e] = 0      // pause
Animation.time[e] = 0     // restart from the first frame
Animation.once[e] = 1     // play once and hold the last frame
```

## Drawing order, 2.5D and screen layers

Higher `Position.z` draws on top. Sprites with the same `z` are drawn together in as few GPU calls as possible.

For top-down and isometric games, where things lower on the screen should cover things behind them, turn a `z` layer into a **y-sorted** layer:

```ts
renderer.ySort.add(1) // sprites on z = 1 draw in order of their bottom edge
```

Put everything that should interleave (characters, trees, walls) on that one layer.

**Screen layers** ignore the camera and use canvas pixels, for HUDs and menus that stay put while the world scrolls:

```ts
renderer.screen.add(100)
spawnText(world, font, 'score 0', { x: 16, y: 16, z: 100 })
```

## Camera

```ts
const camera = game.get(Camera)
camera.x = player.x; camera.y = player.y   // world point at the center of the screen
camera.zoom = 2
const point = camera.toWorld(input.pointer.x, input.pointer.y) // screen → world
```

By default the camera shows world pixels 1:1 with canvas pixels, with (0, 0) at the top left. To fit a fixed-size level on any screen, set `camera.zoom = Math.min(canvas.width / W, canvas.height / H)` and center the camera on the level.

## Text

```ts
const font = await renderer.loadFont({ family: 'ui-monospace, monospace', size: 32, weight: 'bold' })
const label = spawnText(world, font, 'hola, niño', { x: 10, y: 10, z: 5, size: 16, tint: 0xf3e6c9, align: 'left' })
label.set('¿listo?')
label.tint = 0xf28c28
label.alpha = 0.5
```

- `loadFont` draws any CSS font, including web fonts loaded with `@font-face`, into a texture.
- Out of the box it has ASCII, accented Latin letters, ñ, ¿, ¡ and the macron vowels of Classical Nahuatl. Add anything else with `chars: '←→♥★'`. A missing character draws as `?` and logs a warning.
- Each character is a sprite, so text sorts, tints and fades like any sprite. `text.entities` lists those sprites.
- `align: 'center'` or `'right'` aligns each line on `x`. `\n` starts a new line.

## Assets

```ts
const textures = await renderer.loadTextures({
  hero: heroUrl,
  tiles: [tilesUrl, { frameWidth: 16, frameHeight: 16, filter: 'nearest' }],
})
world.spawn([Position], [Sprite, { w: 16, h: 16, texture: textures.tiles, frame: 3 }])
```

- You get back an object with the same keys, so a typo is a type error, not a missing image at runtime.
- `frameWidth`/`frameHeight` turn an image into a grid of frames. `margin` and `spacing` match Tiled's settings.
- `filter: 'nearest'` keeps pixel art crisp.
- With Vite, import images (`import heroUrl from './hero.png'`) or use `new URL('./hero.png', import.meta.url).href`.

## Input

```ts
const input = game.get(Input)
input.keys.has('KeyA')             // held (KeyboardEvent.code)
input.pressed.has('Space')         // went down this frame
input.pressed.has('Pointer')       // click or tap this frame
input.pressed.has('Button0')       // gamepad button this frame (any pad)
input.pointer                      // { x, y, down } in canvas pixels, the last pointer that moved
input.pointers                     // Map of every pressed finger: multi-touch
input.gamepads[0]?.axes[0]         // left stick, -1 to 1 (standard mapping)
```

Read `pressed` in `update` systems; it is cleared at the end of every frame. The input plugin stops touches on the canvas from scrolling or zooming the page.

Gamepads use the standard mapping. `buttons[0]` is the bottom face button (A, cross), `buttons[9]` is start, and `buttons[12..15]` are the d-pad (up, down, left, right).

## Tweens and timers

```ts
tween(game, e, Position, { x: 300, y: 100 }, { duration: 0.5, ease: ease.out, onDone: () => {} })
tween(game, e, Sprite, { alpha: 0 }, { duration: 1 })     // fade out
const cancel = tween(game, e, Sprite, { w: 64, h: 64 }, { ease: ease.outBack })
cancel()

after(game, 2, () => spawnBoss())                         // once, in 2 s
const stop = every(game, 0.5, () => spawnPetal())         // repeatedly
```

- Tweens animate any numeric component field from its current value. Easing curves: `ease.linear`, `in`, `out`, `inOut` and `outBack` (overshoots and settles).
- A tween stops by itself when it finishes or when the entity is despawned.
- Tweens and timers started inside a scene end with the scene.
- For colors, blend with `mixColor(from, to, t)` in a system; a tween would blend the color as a plain number.

## Particles

```ts
burst(world, { x, y, z: 2, texture: textures.spark, tint: 0xf28c28, count: 16, speed: 200, spread: Math.PI * 2, life: 0.6, gravity: 300, size: 6 })
```

Each particle is a sprite that moves, falls, fades out and despawns by itself. Use small white textures so `tint` gives them any color.

## Collisions

For pickups, enemy touches and triggers, test sprite boxes directly:

```ts
overlaps(player, coin)                       // do their boxes touch?
overlaps(player, spike, 4)                   // shrink both boxes by 4 px per side: fairer hits
const enemy = hit(player, enemies.entities)  // the first one touching, or -1
```

These ignore rotation and check one entity against a list. For things that must push, bounce or stack, use physics.

## Physics with Rapier

```bash
npm install @dimforge/rapier2d-simd-compat
```

```ts
import { BodyType, Collider, Physics, rapier, RigidBody, Shape } from 'ollin/rapier'

const game = await createGame({ canvas, plugins: [webgl2(), rapier({ gravity: 25, scale: 32 })] })

world.spawn(
  [Position, { x: 100, y: 0 }], [Rotation], [Sprite, { w: 32, h: 32, texture }],
  [RigidBody, { type: BodyType.Dynamic }],
  [Collider, { shape: Shape.Box, w: 32, h: 32, friction: 0.5, restitution: 0.2 }],
)
```

- Bodies are created on the next fixed step. From then on Rapier moves them and writes the result back to `Position` and `Rotation`.
- Collider sizes are in pixels. `scale` is pixels per meter (Rapier works best with objects of 0.1–10 m), and `gravity` is in m/s².
- For everything else (impulses, velocities, raycasts, joints), use `game.get(Physics)`: `physics.body(e)` is the entity's Rapier body, `physics.world` is the Rapier world, and `physics.rapier` is the Rapier module.
- Rapier's type definitions need `"skipLibCheck": true` in `tsconfig.json`, which the Vite templates and `create-ollin` already set.

## Tiled maps

Make maps in [Tiled](https://www.mapeditor.org): orthogonal or isometric, CSV layer format, with embedded or `.tsj` tilesets. Export them as `.tmj` (JSON).

```ts
const map = await loadTilemap(game, new URL('./level.tmj', import.meta.url).href)
map.width, map.height, map.tileWidth, map.tileHeight
map.layers.ground          // tile entities of the "ground" layer
map.objects.find((o) => o.name === 'player')  // { x, y, z, width, height, properties, ... }
```

- Each tile is an entity with `z = layer index`, so later layers draw on top.
- Hidden layers spawn `Position` only, which makes them handy for invisible collision.
- In isometric maps, object positions are converted to screen pixels.

## Audio

```ts
const sound = game.get(Audio)
const sounds = await sound.load({ jump: jumpUrl, music: musicUrl })
sound.play(sounds.jump, { volume: 0.8, rate: 1.2 })
const stopMusic = sound.play(sounds.music, { loop: true })
sound.volume = 0.5 // master volume
```

Browsers keep audio muted until the first click, tap or key press. The plugin unlocks it then.

## Devtools

```ts
plugins: [webgl2(), input(), ...(import.meta.env.DEV ? [devtools({ components: { Velocity, Health } })] : [])]
```

- The key left of 1 shows or hides a panel with the renderer in use, frames per second, main-thread milliseconds per frame, and the number of entities, sprites and draw calls.
- Click a sprite to see its components live. Pass your own components by name so they show up.
- In the browser console, `ollin.game` is your game.

## WebGL2 and WebGPU

`webgl2()` works in every current browser. `webgpu()` has the same API and draws the same output, and falls back to WebGL2 where WebGPU is missing; `renderer.backend` tells which one runs. Today they cost the same, so use `webgl2()` unless you are experimenting.

## Performance

Ollin is built to keep the main thread free. At 20,000 moving sprites it spends about 12% of a 60 fps frame on a throttled CPU, against 42% for Phaser 4 (README, Performance). To keep it that way in your game:

- Keep per-entity data in components, not in objects or `Map`s.
- Create queries once, outside systems.
- Share textures: put sprites that appear together in one spritesheet, so they draw in one call. The devtools show the number of draw calls.
- Use the devtools' ms per frame, not fps. A frame at 60 fps may be using 2 ms or 15 ms of its 16.6 ms budget.
