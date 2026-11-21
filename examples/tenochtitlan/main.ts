import { debug, devtools } from '../../src'
import { game } from './game.ollin'
import { chapter, title } from './scenes'

// Tenochtitlan: a side-scrolling action platformer from November 1519 to the night of 30 June 1520, seen from the
// Mexica side. Arrows / A D to move, Z / K / Space to jump, X / J to strike, C / L to throw a dart. F2 shows hitboxes.
const { canvas } = game
const resize = () => {
  canvas.width = innerWidth * devicePixelRatio
  canvas.height = innerHeight * devicePixelRatio
}
resize()
addEventListener('resize', resize)
// Plugins are plain functions, so ones the .ollin file does not declare can still be added.
await debug()(game)
await devtools({ open: false })(game)

// ?chapter=1..4 starts a chapter's level directly (for development).
const start = Number(new URLSearchParams(location.search).get('chapter'))
await game.scene(start ? chapter(start - 1) : title)
import.meta.hot?.accept('./scenes', (m) => m && game.scene(start ? m.chapter(start - 1) : m.title))

game.start()
