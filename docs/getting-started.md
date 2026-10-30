# Getting started

This walks you from an empty folder to a running game, then through the code so you can change it. You need [Node.js](https://nodejs.org) 22 or newer.

## Create a game

```bash
npm create ollin@latest my-game
cd my-game
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173). You get a small game: a xoloitzcuintli catches falling cempasúchil petals. Move with the arrow keys or A/D, or hold a finger or the mouse where you want to go.

Press the key left of 1 to open the devtools: frames per second, how long each frame takes, and how many entities and draw calls there are. Click a sprite while it's open to see its data.

## The files

```
my-game/
  index.html        the page with the <canvas>
  src/main.ts       creates the game and picks the plugins
  src/game.ts       the game itself: start here
  src/assets/       images
```

`npm run build` writes a static site to `dist/` that any web host can serve.

## `main.ts`: the game and its plugins

```ts
const game = await createGame({ canvas, plugins: [webgl2(), input()] })
await game.scene(play)
game.start()
```

`createGame` makes an empty game. Everything else comes from plugins: `webgl2()` draws sprites, `input()` reads the keyboard, mouse, touch and gamepads. Add `audio()` for sound and `rapier()` (from `ollin/rapier`) for physics when you need them.

`game.scene(play)` runs your scene, and `game.start()` starts the frame loop.

## Entities and components

Everything in the game is an **entity**: a number that owns some **components**. A component is a bit of data, like a position or a sprite:

```ts
const xolo = world.spawn(
  [Position, { x: 100, y: 200 }],
  [Sprite, { w: 64, h: 64, texture: textures.xolo }],
)
```

Anything with `Position` and `Sprite` gets drawn, centered on its position. Read and change the data through the component, indexed by the entity:

```ts
Position.x[xolo] += 10
Sprite.flipX[xolo] = 1 // face left
```

Your own components are one line. Each field gets a type (`f32` for decimal numbers, `u8`/`u16`/`u32` for whole numbers):

```ts
const Fall = defineComponent({ speed: f32 })
world.spawn([Position, { x: 50 }], [Fall, { speed: 120 }])
```

Fields you leave out are 0, or the default you give `defineComponent({ hp: u16 }, { hp: 3 })`.

## Systems and queries

A **system** is a function that runs every frame. `dt` is the time since the last frame in seconds, so multiplying speeds by it keeps the game the same speed on every screen:

```ts
const falling = world.query(Fall) // every entity that has Fall, kept up to date

game.system((dt) => {
  for (const e of falling.entities) Position.y[e] += Fall.speed[e] * dt
})
```

If a system despawns entities while it loops, loop backwards. Despawning moves the last entity into the empty slot:

```ts
for (let i = falling.entities.length - 1; i >= 0; i--) {
  const e = falling.entities[i]
  if (Position.y[e] > height) world.despawn(e)
}
```

Always read component arrays (`Position.x`) inside the system, not once outside it. See [the guide](./guide.md#entities-components-and-queries) for why.

## Input

```ts
const input = game.get(Input)
input.keys.has('ArrowLeft')   // held right now
input.pressed.has('Space')    // went down this frame: use it for jumps and menus
input.pointer.x, input.pointer.down
```

Key names are `KeyboardEvent.code` values: `KeyA`, `Space`, `ArrowUp`, `Enter`.

## Text

```ts
const font = await renderer.loadFont({ family: 'ui-monospace, monospace', size: 32 })
const score = spawnText(world, font, 'petals 0', { x: 16, y: 16, tint: 0xf28c28 })
score.set('petals 1')
```

Accents and ñ work out of the box. For other symbols, list them: `loadFont({ chars: '←→♥' })`.

## Scenes and hot reload

A scene is a function that sets up a level: it loads what it needs, spawns entities and adds systems. Calling `game.scene(play)` again clears everything the scene made and runs it from scratch. That is how the template restarts after game over.

While `npm run dev` runs, save `game.ts` and the scene restarts with your changes without reloading the page. This line in `main.ts` does it:

```ts
import.meta.hot?.accept('./game', (m) => m && game.scene(m.play))
```

## Things to try

- Make the xolo faster, or the petals fall in a zig-zag (`Position.x[e] += Math.sin(...)`).
- Add a sound: add `audio()` to the plugins, then `const sounds = await game.get(Audio).load({ catch: url })` and `game.get(Audio).play(sounds.catch)`.
- Make petals pop when caught: `tween(game, petal, Sprite, { w: 0, h: 0 }, { duration: 0.2, onDone: () => world.despawn(petal) })`.
- Add a menu scene that starts `play` when `input.pressed.has('Space')`.

Then read [the guide](./guide.md) for everything else: animation, cameras, tile maps, physics, particles and more. For a bigger example, see `examples/xolo` in the Ollin repository: a menu, three levels, enemies and lives.
