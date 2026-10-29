import { Animation, Audio, Camera, Input, loadTilemap, Position, Renderer, Rotation, Sprite, spawnText, type Scene } from '../../src'
import { BodyType, Collider, Physics, RigidBody, Shape } from '../../src/rapier'

// The level is a scene: everything it spawns and every system it registers goes away when the scene changes
// or restarts. Edit this file while `npm run dev` runs and the level restarts in place (see main.ts).
export const level: Scene = async (game) => {
  const { world, canvas } = game
  const camera = game.get(Camera)
  const keys = game.get(Input).keys
  const physics = game.get(Physics)
  const sound = game.get(Audio)

  const renderer = game.get(Renderer)
  const [map, textures, sounds, font] = await Promise.all([
    loadTilemap(game, new URL('./map.tmj', import.meta.url).href),
    renderer.loadTextures({
      player: new URL('./player.png', import.meta.url).href,
      seed: [new URL('./seed.png', import.meta.url).href, { frameWidth: 24, frameHeight: 24 }],
    }),
    sound.load({ jump: new URL('./jump.wav', import.meta.url).href }),
    renderer.loadFont({ family: 'ui-monospace, monospace', size: 32, weight: 'bold' }),
  ])

  // ponytail: one fixed collider per tile; merge rows into strips if tile counts or seam bumps become a problem
  for (const e of map.layers.ground) {
    world.add(e, RigidBody, { type: BodyType.Fixed })
    world.add(e, Collider, { shape: Shape.Box, w: map.tileWidth, h: map.tileHeight })
  }

  const start = map.objects.find((o) => o.name === 'player')!
  const SIZE = 28
  const player = world.spawn(
    [Position, { x: start.x, y: start.y, z: start.z }],
    [Rotation],
    [Sprite, { w: SIZE, h: SIZE, texture: textures.player }],
    [RigidBody, { type: BodyType.Dynamic }],
    [Collider, { shape: Shape.Ball, w: SIZE, friction: 1 }],
  )

  // Cacao seeds to collect: an animated spritesheet, placed as "seed" points in the Tiled map.
  const seeds = map.objects
    .filter((o) => o.name === 'seed')
    .map((o) => world.spawn([Position, { x: o.x, y: o.y, z: o.z }], [Sprite, { w: 24, h: 24, texture: textures.seed }], [Animation, { count: 4, fps: 8 }]))
  const total = seeds.length
  let collected = 0

  // HUD in canvas pixels: z 100 is a screen layer, so it ignores the camera.
  const HUD = 100
  renderer.screen.add(HUD)
  const scale = devicePixelRatio
  spawnText(world, font, 'arrows roll - space jump', { x: 16 * scale, y: 12 * scale, z: HUD, size: 14 * scale, tint: 0xf3e6c9, alpha: 0.8 })
  const score = spawnText(world, font, '', { x: canvas.width - 16 * scale, y: 12 * scale, z: HUD, size: 20 * scale, tint: 0x1f9e9a, align: 'right' })
  const showScore = () => score.set(collected === total ? `all ${total} seeds!` : `seeds ${collected}/${total}`)
  showScore()

  // Feedback with alpha and tint: the ball fades in at the start, and the score flashes gold on each seed.
  // Tint multiplies the texture, so it shows true colors on white art (glyphs) and only darkens colored art.
  Sprite.alpha[player] = 0
  let flash = 0

  const SPEED = 7 // m/s
  const JUMP = 11 // m/s
  let jumpHeld = false

  game.system(() => {
    const body = physics.body(player)
    if (!body) return
    const left = keys.has('ArrowLeft') || keys.has('KeyA')
    const right = keys.has('ArrowRight') || keys.has('KeyD')
    const jump = keys.has('Space') || keys.has('ArrowUp') || keys.has('KeyW')
    const v = body.linvel()
    // Grounded = something solid right below the ball (radius + a small margin), ignoring the player's own body.
    const ray = new physics.rapier.Ray(body.translation(), { x: 0, y: 1 })
    const grounded = physics.world.castRay(ray, SIZE / 2 / physics.scale + 0.1, true, undefined, undefined, undefined, body) !== null
    let vy = v.y
    if (jump && !jumpHeld && grounded) {
      vy = -JUMP
      sound.play(sounds.jump, { rate: 0.9 + Math.random() * 0.2 })
    }
    jumpHeld = jump
    body.setLinvel({ x: (Number(right) - Number(left)) * SPEED, y: vy }, true)

    // Fell off the map: restart the scene, which despawns everything (bodies included) and runs this function again.
    if (Position.y[player] > map.height + 200) void game.scene(level)
  })

  game.system((dt) => {
    const { x, y } = Position
    for (let i = seeds.length - 1; i >= 0; i--) {
      const seed = seeds[i]
      if (Math.hypot(x[seed] - x[player], y[seed] - y[player]) > SIZE) continue
      world.despawn(seed)
      seeds.splice(i, 1)
      collected++
      flash = 1
      sound.play(sounds.jump, { rate: 1.6, volume: 0.6 })
      showScore()
    }
    flash = Math.max(0, flash - dt * 2)
    const tint = mix(0x1f9e9a, 0xf2c14e, flash) // xihuitl turquoise to gold
    for (const e of score.entities) Sprite.tint[e] = tint
    Sprite.alpha[player] = Math.min(1, Sprite.alpha[player] + dt * 2)
  })

  // Camera: fit the map height, follow the player horizontally, stay inside the map.
  game.system((dt) => {
    camera.zoom = canvas.height / map.height
    const half = camera.width / 2 / camera.zoom
    const target = Math.min(Math.max(Position.x[player], half), map.width - half)
    camera.x += (target - camera.x) * Math.min(1, dt * 6)
    camera.y = map.height / 2
  })
}

/** Blends two 0xRRGGBB colors, `t` from 0 (a) to 1 (b). */
const mix = (a: number, b: number, t: number) => {
  let out = 0
  for (const shift of [16, 8, 0]) out |= Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift
  return out
}
