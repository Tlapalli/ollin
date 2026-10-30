#!/usr/bin/env node
// npm create ollin@latest my-game → copies ./template into my-game and names the package after the folder.
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const name = process.argv[2] ?? 'ollin-game'
const dir = resolve(name)
if (existsSync(dir) && readdirSync(dir).length) {
  console.error(`${name} already exists and is not empty.`)
  process.exit(1)
}

cpSync(fileURLToPath(new URL('./template', import.meta.url)), dir, { recursive: true })
// npm drops .gitignore files from published packages, so the template ships it under another name.
renameSync(join(dir, '_gitignore'), join(dir, '.gitignore'))
const manifest = join(dir, 'package.json')
const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
pkg.name = basename(dir).toLowerCase().replace(/[^a-z0-9-~._]+/g, '-')
writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n')

const where = relative(process.cwd(), dir) || '.'
const cd = /\s/.test(where) ? JSON.stringify(where) : where
console.log(`\nYour Ollin game is in ${where}. Next:\n\n  cd ${cd}\n  npm install\n  npm run dev\n`)
