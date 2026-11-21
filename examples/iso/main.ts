import { Animation, Camera, Input, Position, Renderer, spawnText, Sprite } from '../../src'
import { assets, game } from './game.ollin'

// Arrow keys or WASD to walk around the temple blocks. The blocks layer is y-sorted, so the walker
// goes behind blocks that are closer to the camera and in front of the ones behind it.
const { canvas, world } = game
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio
const renderer = game.get(Renderer)
const camera = game.get(Camera)
const keys = game.get(Input).keys

const { walker: walkerTexture, ui: font } = assets
const map = assets.map.spawn()

// The walker joins the blocks layer, and that layer draws in order of each sprite's bottom edge.
const BLOCKS = Position.z[map.layers.blocks[0]]
renderer.ySort.add(BLOCKS)

// A point is blocked when a block stands on its diamond cell.
const solid = (x: number, y: number) => map.tileAt('blocks', x, y) >= 0

const start = map.objects.find((o) => o.name === 'player')!
const W = 32
const H = 48
// 4-frame walk cycle; frame 0 doubles as the idle pose.
const walker = world.spawn(
  [Position, { x: start.x, y: start.y - H / 2, z: BLOCKS }],
  [Sprite, { w: W, h: H, texture: walkerTexture }],
  [Animation, { count: 4, fps: 8 }],
)

const HUD = 100
renderer.screen.add(HUD)
spawnText(world, font, '←↑→↓ or WASD to walk', { x: 16 * devicePixelRatio, y: 12 * devicePixelRatio, z: HUD, size: 16 * devicePixelRatio, tint: 0xf3e6c9 })

camera.zoom = Math.min(canvas.width / map.width, canvas.height / map.height) * 0.9
camera.x = map.width / 2
camera.y = map.height / 2
const SPEED = 140

game.system((dt) => {
  const dx = +(keys.has('ArrowRight') || keys.has('KeyD')) - +(keys.has('ArrowLeft') || keys.has('KeyA'))
  const dy = +(keys.has('ArrowDown') || keys.has('KeyS')) - +(keys.has('ArrowUp') || keys.has('KeyW'))
  const { x, y } = Position
  // Move each axis separately so the walker slides along walls; collide with the feet only.
  const nx = x[walker] + dx * SPEED * dt
  if (!solid(nx, y[walker] + H / 2)) x[walker] = nx
  const ny = y[walker] + dy * SPEED * dt * 0.5 // isometric: vertical moves cover half the distance
  if (!solid(x[walker], ny + H / 2)) y[walker] = ny
  // Face the way we walk (the sheet faces right), and stand still on frame 0 when idle.
  if (dx) Sprite.flipX[walker] = dx < 0 ? 1 : 0
  Animation.fps[walker] = dx || dy ? 8 : 0
  if (!dx && !dy) Animation.time[walker] = 0
})

game.start()
