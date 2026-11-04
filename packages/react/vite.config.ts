import { defineConfig } from 'vite-plus';

export default defineConfig({
    pack: {
        entry: ['src/index.ts'],
        fixedExtension: false,
        dts: true,
        format: 'esm',
        sourcemap: true,
        platform: 'neutral',
    },
});
