import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Il build produce un unico dist/index.html giocabile anche con doppio click.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  test: { include: ['tests/**/*.test.ts'] },
});
