<?php

declare(strict_types=1);

namespace Formbraid\Laravel;

use RuntimeException;
use stdClass;

/** Stages the complete generation and only replaces/removes unchanged, previously owned files. */
final readonly class GeneratedFiles
{
    public function __construct(private string $output, private string $enum) {}

    public static function path(mixed $path, string $setting): string
    {
        if (! is_string($path) || $path === '' || str_contains($path, '\\') || str_starts_with($path, '/') ||
            preg_match('~(?:^|/)\.{1,2}(?:/|$)|[\x00-\x1f:]~', $path)) {
            throw new RuntimeException("formbraid.{$setting} must be a project-relative path without traversal.");
        }

        return rtrim($path, '/');
    }

    /** @param array<string, string> $files Project-relative paths and source contents. */
    public function publish(array $files): void
    {
        $manifest = $this->output.'/.formbraid-manifest.json';
        $this->safe($manifest);
        $owned = [];
        if (is_file(base_path($manifest))) {
            $json = json_decode($this->read($manifest), flags: JSON_THROW_ON_ERROR);
            if (! $json instanceof stdClass || ($json->version ?? null) !== 1 || ! ($json->files ?? null) instanceof stdClass) {
                throw new RuntimeException('Invalid Formbraid generated file manifest.');
            }
            foreach (get_object_vars($json->files) as $path => $hash) {
                if (! is_string($hash) || ! preg_match('/^[a-f0-9]{64}$/D', $hash)) {
                    throw new RuntimeException('Invalid Formbraid generated file hash.');
                }
                $this->allowed($path);
                $this->safe($path);
                $owned[$path] = $hash;
            }
        }
        foreach (array_unique([...array_keys($owned), ...array_keys($files)]) as $path) {
            $this->allowed($path);
            $this->safe($path);
            if (file_exists(base_path($path))) {
                if (! is_file(base_path($path)) || ! isset($owned[$path]) || hash('sha256', $this->read($path)) !== $owned[$path]) {
                    throw new RuntimeException("Refusing to overwrite or delete non-owned or modified file: {$path}");
                }
            }
        }
        ksort($files);
        $hashes = array_map(static fn (string $source): string => hash('sha256', $source), $files);
        $files[$manifest] = TypeShape::literal(['version' => 1, 'files' => (object) $hashes], true)."\n";
        $staged = [];
        $previous = [];
        $published = [];
        try {
            foreach ($files as $path => $source) {
                $directory = dirname(base_path($path));
                if (! is_dir($directory) && ! mkdir($directory, 0755, true) && ! is_dir($directory)) {
                    throw new RuntimeException("Cannot create generated output directory: {$directory}");
                }
                $temp = tempnam($directory, '.formbraid-');
                if ($temp === false) {
                    throw new RuntimeException("Cannot stage generated file: {$path}");
                }
                $staged[$path] = $temp;
                if (file_put_contents($temp, $source) === false) {
                    throw new RuntimeException("Cannot stage generated file: {$path}");
                }
            }
            foreach (array_unique([...array_keys($files), ...array_keys($owned)]) as $path) {
                $previous[$path] = is_file(base_path($path)) ? $this->read($path) : null;
            }
            foreach ($staged as $path => $temp) {
                if (! rename($temp, base_path($path))) {
                    throw new RuntimeException("Cannot publish generated file: {$path}");
                }
                $published[] = $path;
            }
            foreach (array_diff_key($owned, $files) as $path => $hash) {
                if (is_file(base_path($path))) {
                    if (! unlink(base_path($path))) {
                        throw new RuntimeException("Cannot remove obsolete generated file: {$path}");
                    }
                    $published[] = $path;
                }
            }
        } catch (\Throwable $error) {
            foreach (array_reverse($published) as $path) {
                $source = $previous[$path] ?? null;
                if ($source === null) {
                    unlink(base_path($path));
                } else {
                    file_put_contents(base_path($path), $source);
                }
            }
            throw $error;
        } finally {
            foreach ($staged as $temp) {
                if (is_file($temp)) {
                    unlink($temp);
                }
            }
        }
    }

    private function allowed(string $path): void
    {
        self::path($path, 'generated file');
        if ($path !== $this->enum && (! str_starts_with($path, $this->output.'/') || ! str_ends_with($path, '.ts'))) {
            throw new RuntimeException("Invalid generator-owned path: {$path}");
        }
    }

    private function safe(string $path): void
    {
        $current = base_path();
        foreach (explode('/', $path) as $segment) {
            $current .= '/'.$segment;
            if (is_link($current)) {
                throw new RuntimeException("Refusing to write through symlink: {$path}");
            }
        }
    }

    private function read(string $path): string
    {
        $source = file_get_contents(base_path($path));

        return $source === false ? throw new RuntimeException("Cannot read generated file: {$path}") : $source;
    }
}
