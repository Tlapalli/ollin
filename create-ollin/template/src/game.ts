import { Animation, defineComponent, every, f32, Input, overlaps, Position, Renderer, spawnText, Sprite, type Scene } from '@tlapalli/ollin'
import petalUrl from './assets/petal.png'
import sparkUrl from './assets/spark.png'
import xoloUrl from './assets/xolo.png'

// Catch the falling cempasúchil petals with the xolo. Miss three and it's over.
// Arrow keys or A/D, or hold a finger (or the mouse) where you want to go.

/** Components are plain data: typed arrays indexed by entity, so `Fall.speed[petal]` is that petal's speed. */
const Fall = defineComponent({ speed: f32 })

/** A scene sets up a level: it spawns entities and adds systems. `game.scene(play)` starts it again from scratch. */
export const play: Scene = async (game) => {
  const { world, canvas } = game
  const input = game.get(Input)
  const renderer = game.get(Renderer)
  const [textures, font] = await Promise.all([
    renderer.loadTextures({
      xolo: [xoloUrl, { frameWidth: 16, frameHeight: 16, filter: 'nearest' }],
      petal: [petalUrl, { frameWidth: 12, frameHeight: 12, filter: 'nearest' }],
      spark: sparkUrl,
    }),
    renderer.loadFont({ family: 'ui-monospace, monospace', size: 32, weight: 'bold' }),
  ])
  const { width, height } = canvas
  const S = 4 * devicePixelRatio // pixel art scale

  // An entity is an id; spawn gives it components. Position + Sprite is all the renderer needs to draw it.
  const xolo = world.spawn(
    [Position, { x: width / 2, y: height - 12 * S }],
    [Sprite, { w: 16 * S, h: 16 * S, texture: textures.xolo }],
    [Animation, { count: 2, fps: 8 }],
  )

  let caught = 0
  let missed = 0
  let over = false
  // Higher z draws on top: text on 1, everything else on the default 0.
  const score = spawnText(world, font, '', { x: 6 * S, y: 4 * S, z: 1, size: 6 * S, tint: 0xf28c28 })
  const showScore = () => score.set(`petals ${caught}   missed ${missed}/3`)
  showScore()

  // A new petal every 0.6 s, falling faster as the score grows.
  every(game, 0.6, () => {
    if (over) return
    world.spawn(
      [Position, { x: 8 * S + Math.random() * (width - 16 * S), y: -8 * S }],
      [Sprite, { w: 12 * S, h: 12 * S, texture: textures.petal }],
      [Animation, { count: 2, fps: 3 }],
      [Fall, { speed: (40 + Math.random() * 30 + caught * 2) * S }],
    )
  })

  // A query is the live list of entities that have these components.
  const petals = world.query(Fall)

  // A system runs every frame; dt is the time since the last frame, in seconds.
  game.system((dt) => {
    if (over) {
      if (input.pressed.has('Space') || input.pressed.has('Pointer')) void game.scene(play)
      return
    }

    const { keys, pointer } = input
    let dx = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'))
    if (pointer.down && Math.abs(pointer.x - Position.x[xolo]) > 2 * S) dx = Math.sign(pointer.x - Position.x[xolo])
    Position.x[xolo] = Math.min(Math.max(Position.x[xolo] + dx * 70 * S * dt, 8 * S), width - 8 * S)
    if (dx) Sprite.flipX[xolo] = dx < 0 ? 1 : 0
    Animation.fps[xolo] = dx ? 8 : 0

    // Backwards, because despawning moves the last petal into the current slot.
    for (let i = petals.entities.length - 1; i >= 0; i--) {
      const petal = petals.entities[i]
      Position.y[petal] += Fall.speed[petal] * dt
      if (overlaps(xolo, petal, S)) {
        renderer.burst({ x: Position.x[petal], y: Position.y[petal], texture: textures.spark, tint: 0xf28c28, size: 2 * S, speed: 40 * S })
        world.despawn(petal)
        caught++
        showScore()
      } else if (Position.y[petal] > height + 8 * S) {
        world.despawn(petal)
        missed++
        showScore()
        if (missed === 3) {
          over = true
          spawnText(world, font, 'game over\npress space or tap', { x: width / 2, y: height / 3, z: 1, size: 8 * S, tint: 0xf3e6c9, align: 'center' })
        }
      }
    }
  })
}
