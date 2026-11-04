<?php

declare(strict_types=1);

namespace Formbraid\Laravel;

use Illuminate\Console\Command;
use RuntimeException;

final class InitCommand extends Command
{
    protected $signature = 'formbraid:init {--register-vite : Register the integration in a conventional Vite config}';

    protected $description = 'Scaffold editable React components and build-only Laravel integration wiring';

    public function handle(): int
    {
        try {
            $metadata = GeneratedFiles::path(config('formbraid.metadata'), 'metadata');
            $output = GeneratedFiles::path(config('formbraid.output'), 'output');
            $enum = GeneratedFiles::path(config('formbraid.component_enum'), 'component_enum');
            $directory = dirname($metadata);
            $watch = ['app/**/*.php', 'routes/**/*.php', 'config/formbraid.php'];
            $requests = config('formbraid.requests', []);
            if (! is_array($requests)) {
                throw new RuntimeException('formbraid.requests must be an array.');
            }
            foreach ($requests as $pattern) {
                $pattern = GeneratedFiles::path($pattern, 'requests');
                $watch[] = str_contains($pattern, '*') || str_ends_with($pattern, '.php') ? $pattern : $pattern.'/**/*.php';
            }
            $integration = "import type { Integration } from '@formbraid/core/vite';\n\n".
                "export default {\n    name: 'laravel',\n    registry: new URL('./index.ts', import.meta.url),\n".
                '    metadata: new URL('.TypeShape::literal('./'.basename($metadata)).", import.meta.url),\n".
                "    command: ['php', 'artisan', 'formbraid:generate'],\n".
                '    watch: '.TypeShape::literal(array_values(array_unique($watch))).",\n".
                '    outputs: '.TypeShape::literal([$output.'/**', $enum]).",\n} satisfies Integration;\n";
            foreach (['index.ts', 'fields.tsx', 'form-components.tsx'] as $file) {
                $this->create($directory.'/'.$file, $this->stub($file));
            }
            $this->create($directory.'/laravel.ts', $integration);
            $this->create('config/formbraid.php', $this->stub('../config/formbraid.php'));
            $ignore = base_path('.gitignore');
            $source = is_file($ignore) ? file_get_contents($ignore) : '';
            if ($source === false) {
                throw new RuntimeException('Cannot read .gitignore.');
            }
            $entry = '/'.$metadata;
            if (! in_array($entry, preg_split('/\R/', $source) ?: [], true)) {
                $this->write('.gitignore', rtrim($source)."\n{$entry}\n");
            }
            $this->newLine();
            $import = "import { vitePlugin as formbraid } from '@formbraid/core/vite';\n".
                'import laravelForms from '.TypeShape::literal('./'.$directory.'/laravel').';';
            $plugin = 'formbraid({ integrations: [laravelForms] })';
            if (! $this->option('register-vite') || ! $this->registerVite($import, $plugin)) {
                $this->line("Add these imports to vite.config.ts (or .js):\n{$import}\n\nAdd to plugins: {$plugin}");
            }
            $this->info('Start Vite once to produce component metadata and run formbraid:generate. Artisan never refreshes metadata.');

            return self::SUCCESS;
        } catch (\Throwable $error) {
            $this->error($error->getMessage());

            return self::FAILURE;
        }
    }

    private function stub(string $file): string
    {
        $path = str_starts_with($file, '../') ? __DIR__.'/../'.substr($file, 3) : __DIR__.'/../stubs/react/'.$file;
        $source = file_get_contents($path);

        return $source === false ? throw new RuntimeException("Cannot read scaffold {$file}.") : $source;
    }

    private function create(string $path, string $source): void
    {
        if (file_exists(base_path($path))) {
            $this->line("Preserved {$path}");

            return;
        }
        $this->write($path, $source);
        $this->line("Created {$path}");
    }

    private function write(string $path, string $source): void
    {
        $absolute = base_path($path);
        // Never follow a symlink outside the application's scaffold directory.
        $current = base_path();
        foreach (explode('/', $path) as $segment) {
            $current .= '/'.$segment;
            if (is_link($current)) {
                throw new RuntimeException("Refusing to scaffold through symlink: {$path}");
            }
        }
        if (! is_dir(dirname($absolute)) && ! mkdir(dirname($absolute), 0755, true) && ! is_dir(dirname($absolute))) {
            throw new RuntimeException("Cannot create scaffold directory: {$path}");
        }
        if (file_put_contents($absolute, $source) === false) {
            throw new RuntimeException("Cannot write scaffold: {$path}");
        }
    }

    /** Only edit the conventional literal plugins array. Complex configs get manual instructions. */
    private function registerVite(string $imports, string $plugin): bool
    {
        $candidates = array_filter(['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'], fn (string $file): bool => is_file(base_path($file)));
        if (count($candidates) !== 1) {
            return false;
        }
        $file = array_values($candidates)[0];
        $source = file_get_contents(base_path($file));
        if ($source === false) {
            throw new RuntimeException("Cannot read {$file}.");
        }
        if (str_contains($source, $imports) && str_contains($source, $plugin)) {
            $this->info('Vite integration already registered.');

            return true;
        }
        // Mask strings/comments, preserving offsets. Reject regex/division rather than guessing at TS syntax.
        $tokens = <<<'REGEX'
~"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|//[^\r\n]*|/\*[\s\S]*?\*/~
REGEX;
        $masked = preg_replace_callback($tokens, static fn (array $match): string => preg_replace('/[^\r\n]/', ' ', $match[0]) ?? '', $source);
        if ($masked === null || str_contains($masked, '/') || preg_match('/\b(?:formbraid|laravelForms)\b/', $masked) ||
            preg_match_all('/export\s+default\s+defineConfig\s*\(\s*\{\s*plugins\s*:\s*\[/', $masked, $matches, PREG_OFFSET_CAPTURE) !== 1) {
            return false;
        }
        $position = $matches[0][0][1] + strlen($matches[0][0][0]);
        $this->write($file, $imports."\n".substr_replace($source, "\n        {$plugin},", $position, 0));
        $this->info("Registered integration in {$file}.");

        return true;
    }
}
