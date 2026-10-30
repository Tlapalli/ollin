import { createGame, devtools, input, webgl2 } from 'ollin'
import { play } from './game'

const canvas = document.querySelector('canvas')!
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio

const game = await createGame({
  canvas,
  // devtools (fps, entity counts, inspector) only while developing; the key left of 1 toggles it.
  plugins: [webgl2({ background: [0.07, 0.05, 0.09, 1] }), input(), ...(import.meta.env.DEV ? [devtools()] : [])],
})

await game.scene(play)
// Hot reload: save game.ts and the scene restarts with your changes, no page reload.
import.meta.hot?.accept('./game', (m) => m && game.scene(m.play))

game.start()
