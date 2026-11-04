import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';
import { vitePlugin } from '@formbraid/core/vite';
import laravelForms from './laravel.js';
import root from '../../vite.config.js';

export default defineConfig({
    resolve: root.resolve,
    plugins: [vitePlugin({ integrations: [laravelForms] }), react()],
    server: {
        proxy: {
            '/users': 'http://127.0.0.1:8000',
            '/csrf-cookie': 'http://127.0.0.1:8000',
        },
    },
});
