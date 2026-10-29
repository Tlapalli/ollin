import { Camera, createGame, input, Input, loadTilemap, Position, Renderer, Sprite, webgl2 } from '../../src'

// Arrow keys or WASD to walk around the temple blocks. The blocks layer is y-sorted, so the walker
// goes behind blocks that are closer to the camera and in front of the ones behind it.
const canvas = document.querySelector('canvas')!
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio

const game = await createGame({ canvas, plugins: [webgl2({ background: [0.11, 0.09, 0.08, 1] }), input()] })
const { world } = game
const renderer = game.get(Renderer)
const camera = game.get(Camera)
const keys = game.get(Input).keys

const [map, textures] = await Promise.all([
  loadTilemap(game, new URL('./map.tmj', import.meta.url).href),
  renderer.loadTextures({ walker: new URL('./walker.png', import.meta.url).href }),
])

// The walker joins the blocks layer, and that layer draws in order of each sprite's bottom edge.
const BLOCKS = Position.z[map.layers.blocks[0]]
renderer.ySort.add(BLOCKS)

const { tileWidth: tw, tileHeight: th } = map
const originX = map.width / 2 // isometric maps are as wide as they are tall in grid cells here
const cellOf = (x: number, y: number) => {
  const u = (x - originX) / (tw / 2)
  const v = y / (th / 2)
  return `${Math.floor((v + u) / 2)},${Math.floor((v - u) / 2)}`
}
// A block's bottom corner is the bottom of its diamond; half a tile up is the diamond's center.
const solid = new Set(map.layers.blocks.map((e) => cellOf(Position.x[e], Position.y[e] + Sprite.h[e] / 2 - th / 2)))

const start = map.objects.find((o) => o.name === 'player')!
const W = 32
const H = 48
const walker = world.spawn([Position, { x: start.x, y: start.y - H / 2, z: BLOCKS }], [Sprite, { w: W, h: H, texture: textures.walker }])

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
  if (!solid.has(cellOf(nx, y[walker] + H / 2))) x[walker] = nx
  const ny = y[walker] + dy * SPEED * dt * 0.5 // isometric: vertical moves cover half the distance
  if (!solid.has(cellOf(x[walker], ny + H / 2))) y[walker] = ny
})

game.start()
