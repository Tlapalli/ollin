import { audio, createGame, devtools, input, webgl2 } from '../../src'
import { menu } from './scenes'

// Mictlan: a side-scrolling action platformer. Arrows / A D to move, Z / K / Space to jump, X / J to strike with the
// macuahuitl. Gamepad and touch work too (see the menu).
const canvas = document.querySelector('canvas')!
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio

const game = await createGame({
  canvas,
  plugins: [webgl2({ background: [0.06, 0.05, 0.08, 1] }), input(), audio(), devtools({ open: false })],
})

await game.scene(menu)
import.meta.hot?.accept('./scenes', (m) => m && game.scene(m.menu))

game.start()
