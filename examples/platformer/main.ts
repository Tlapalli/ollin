import { audio, createGame, devtools, input, webgl2, webgpu } from '../../src'
import { Collider, rapier, RigidBody } from '../../src/rapier'
import { level } from './level'

// Arrow keys or A/D to roll, Space or Up to jump. Map made in Tiled format: examples/platformer/map.tmj.
const canvas = document.querySelector('canvas')!
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio

// ?webgpu runs the same game on the WebGPU backend.
const renderer = new URLSearchParams(location.search).has('webgpu') ? webgpu : webgl2
const game = await createGame({
  canvas,
  plugins: [renderer({ background: [0.11, 0.09, 0.08, 1] }), input(), rapier({ gravity: 25, scale: 32 }), audio(), devtools({ components: { RigidBody, Collider } })],
})

await game.scene(level)
// Hot reload: when level.ts changes, restart the new version of the scene without reloading the page.
import.meta.hot?.accept('./level', (m) => m && game.scene(m.level))

game.start()
