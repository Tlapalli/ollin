import { Audio, Camera, Input, loadTilemap, Position, Renderer, Rotation, Sprite, type Scene } from '../../src'
import { BodyType, Collider, Physics, RigidBody, Shape } from '../../src/rapier'

// The level is a scene: everything it spawns and every system it registers goes away when the scene changes
// or restarts. Edit this file while `npm run dev` runs and the level restarts in place (see main.ts).
export const level: Scene = async (game) => {
  const { world, canvas } = game
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

    // Fell off the map: restart the scene, which despawns everything (bodies included) and runs this function again.
    if (Position.y[player] > map.height + 200) void game.scene(level)
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
