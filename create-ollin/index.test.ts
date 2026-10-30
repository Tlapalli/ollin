import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const cli = new URL('./index.js', import.meta.url).pathname

it('scaffolds the template into a new folder named after the project', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'create-ollin-'))
  execFileSync('node', [cli, 'My Game'], { cwd })
  const dir = join(cwd, 'My Game')
  expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name).toBe('my-game')
  expect(existsSync(join(dir, '.gitignore'))).toBe(true)
  expect(existsSync(join(dir, 'src', 'game.ts'))).toBe(true)
  // A second run must not overwrite it.
  expect(() => execFileSync('node', [cli, 'My Game'], { cwd, stdio: 'pipe' })).toThrow()
})
