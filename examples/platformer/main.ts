import { audio, createGame, input, webgl2 } from '../../src'
import { rapier } from '../../src/rapier'
import { level } from './level'

// Arrow keys or A/D to roll, Space or Up to jump. Map made in Tiled format: examples/platformer/map.tmj.
const canvas = document.querySelector('canvas')!
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio

const game = await createGame({
  canvas,
  plugins: [webgl2({ background: [0.11, 0.09, 0.08, 1] }), input(), rapier({ gravity: 25, scale: 32 }), audio()],
})

await game.scene(level)
// Hot reload: when level.ts changes, restart the new version of the scene without reloading the page.
import.meta.hot?.accept('./level', (m) => m && game.scene(m.level))

document.querySelector('#stats')!.textContent = '← → roll · space jump'
game.start()
