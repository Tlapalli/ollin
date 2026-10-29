import { audio, createGame, devtools, input, webgl2 } from '../../src'
import { menu } from './scenes'

// Xolo: a xoloitzcuintli, the dog that guides souls through Mictlan, gathers cempasuchil petals while obsidian
// spirits drift around. Arrows / WASD, a gamepad, or hold a finger (or the mouse) where you want to go.
const canvas = document.querySelector('canvas')!
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio

const game = await createGame({
  canvas,
  plugins: [webgl2({ background: [0.07, 0.05, 0.09, 1] }), input(), audio(), devtools({ open: false })],
})

await game.scene(menu)
import.meta.hot?.accept('./scenes', (m) => m && game.scene(m.menu))

game.start()
