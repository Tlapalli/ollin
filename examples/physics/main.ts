import { createGame, devtools, input, Input, Position, Renderer, Rotation, Sprite, webgl2 } from '../../src'
import { BodyType, Collider, rapier, RigidBody, Shape } from '../../src/rapier'
import ballUrl from './ball.png'
import boxUrl from './box.png'
import groundUrl from './ground.png'

// Hold the mouse button to drop glyph boxes and balls onto the ground.
const canvas = document.querySelector('canvas')!
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio

const game = await createGame({ canvas, plugins: [webgl2(), input(), rapier(), devtools({ components: { RigidBody, Collider } })] })
const { world } = game
const renderer = game.get(Renderer)
const pointer = game.get(Input).pointer
const [box, ball, ground] = await Promise.all([boxUrl, ballUrl, groundUrl].map((url) => renderer.loadTexture(url)))

const SIZE = 40 * devicePixelRatio

// Ground and two walls, fixed in place.
const wall = (x: number, y: number, w: number, h: number) =>
  world.spawn(
    [Position, { x, y }],
    [Sprite, { w, h, texture: ground }],
    [RigidBody, { type: BodyType.Fixed }],
    [Collider, { shape: Shape.Box, w, h }],
  )
const T = 20 * devicePixelRatio
wall(canvas.width / 2, canvas.height - T / 2, canvas.width, T)
wall(T / 2, canvas.height / 2, T, canvas.height)
wall(canvas.width - T / 2, canvas.height / 2, T, canvas.height)

let cooldown = 0
game.system((dt) => {
  cooldown -= dt
  if (!pointer.down || cooldown > 0) return
  cooldown = 0.05
  const isBall = Math.random() < 0.4
  world.spawn(
    [Position, { x: pointer.x + (Math.random() - 0.5) * 10, y: pointer.y }],
    [Rotation, { angle: Math.random() * Math.PI }],
    [Sprite, { w: SIZE, h: SIZE, texture: isBall ? ball : box }],
    [RigidBody, { type: BodyType.Dynamic }],
    [Collider, { shape: isBall ? Shape.Ball : Shape.Box, w: SIZE, h: SIZE, restitution: isBall ? 0.5 : 0 }],
  )
})


game.start()
