import type { Integration } from '@formbraid/core/vite';

export default {
    name: 'laravel',
    registry: new URL('src/forms.ts', import.meta.url),
    metadata: new URL('src/_metadata.json', import.meta.url),
    command: ['php', 'artisan', 'formbraid:generate'],
    watch: ['php/**/*.php', 'routes/**/*.php', 'config/formbraid.php'],
    outputs: ['src/generated/**', 'php/Enums/FormField.php'],
} satisfies Integration;
