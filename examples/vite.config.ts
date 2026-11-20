import { defineConfig } from 'vite'
import { ollin } from '../src/vite'

// `npm run dev` serves examples/ with this config. Examples import the engine from source, so the `.ollin` files they
// use compile against it too (every example sits two folders below src/).
export default defineConfig({ plugins: [ollin({ runtime: '../../src' })] })
