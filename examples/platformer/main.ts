import { Audio, audio, Camera, createGame, input, Input, loadTilemap, Position, Renderer, Rotation, Sprite, webgl2 } from '../../src'
import { BodyType, Collider, Physics, rapier, RigidBody, Shape } from '../../src/rapier'

// Arrow keys or A/D to roll, Space or Up to jump. Map made in Tiled format: examples/platformer/map.tmj.
const canvas = document.querySelector('canvas')!
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio

const game = await createGame({
  canvas,
  plugins: [webgl2({ background: [0.11, 0.09, 0.08, 1] }), input(), rapier({ gravity: 25, scale: 32 }), audio()],
})
const { world } = game
const camera = game.get(Camera)
const keys = game.get(Input).keys
const physics = game.get(Physics)
const sound = game.get(Audio)

const [map, textures, sounds] = await Promise.all([
  loadTilemap(game, new URL('./map.tmj', import.meta.url).href),
  game.get(Renderer).loadTextures({ player: new URL('./player.png', import.meta.url).href }),
  sound.load({ jump: new URL('./jump.wav', import.meta.url).href }),
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

  if (Position.y[player] > map.height + 200) {
    body.setTranslation({ x: start.x / physics.scale, y: start.y / physics.scale }, true)
    body.setLinvel({ x: 0, y: 0 }, true)
  }
})

// Camera: fit the map height, follow the player horizontally, stay inside the map.
game.system((dt) => {
  camera.zoom = canvas.height / map.height
  const half = camera.width / 2 / camera.zoom
  const target = Math.min(Math.max(Position.x[player], half), map.width - half)
  camera.x += (target - camera.x) * Math.min(1, dt * 6)
  camera.y = map.height / 2
})

document.querySelector('#stats')!.textContent = '← → roll · space jump'
game.start()
