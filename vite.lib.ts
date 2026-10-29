import { defineConfig } from 'vite'

// Library build for npm: `npm run build`. The dev server (`npm run dev`) serves examples/ without this file.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    lib: { entry: { index: 'src/index.ts', rapier: 'src/rapier.ts' }, formats: ['es'] },
    rollupOptions: { external: [/^@dimforge\//] },
  },
})
