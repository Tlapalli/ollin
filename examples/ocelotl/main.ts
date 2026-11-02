import { audio, createGame, devtools, input, webgl2 } from '../../src'
import { menu } from './scenes'

// Ocelotl: an isometric wave survival game. Arrows / WASD / a gamepad stick to move, Space / J / gamepad A to throw
// obsidian darts (they aim at the nearest foe), or hold a finger (or the mouse) to walk there and throw.
const canvas = document.querySelector('canvas')!
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio

const game = await createGame({
  canvas,
  plugins: [webgl2({ background: [0.05, 0.08, 0.07, 1] }), input(), audio(), devtools({ open: false })],
})

await game.scene(menu)
import.meta.hot?.accept('./scenes', (m) => m && game.scene(m.menu))

game.start()
