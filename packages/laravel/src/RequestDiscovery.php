<?php

declare(strict_types=1);

namespace Formbraid\Laravel;

use Illuminate\Foundation\Http\FormRequest;
use ReflectionClass;
use RuntimeException;
use Symfony\Component\Finder\Finder;

final class RequestDiscovery
{
    /**
     * @param  list<string>  $patterns  Project-relative glob patterns, or legacy directories.
     * @return list<class-string<FormRequest>>
     */
    public function discover(array $patterns): array
    {
        $files = [];
        foreach ($patterns as $pattern) {
            $path = base_path($pattern);
            if (is_dir($path)) {
                foreach ((new Finder)->files()->in($path)->name('*.php') as $file) {
                    $files[$file->getRealPath()] = true;
                }

                continue;
            }
            $segments = explode('/', str_replace('\\', '/', $pattern));
            $prefix = [];
            while ($segments !== [] && ! strpbrk($segments[0], '*?[')) {
                $prefix[] = array_shift($segments);
            }
            if ($segments === []) {
                if (! is_file($path)) {
                    throw new RuntimeException("Request path does not exist: {$path}");
                }
                $files[realpath($path)] = true;

                continue;
            }
            $root = base_path(implode('/', $prefix));
            if (! is_dir($root)) {
                continue;
            }
            $regex = self::globRegex(implode('/', $segments));
            foreach ((new Finder)->files()->in($root)->name('*.php') as $file) {
                if (preg_match($regex, str_replace('\\', '/', $file->getRelativePathname()))) {
                    $files[$file->getRealPath()] = true;
                }
            }
        }
        ksort($files);
        $classes = [];
        foreach (array_keys($files) as $file) {
            $source = file_get_contents($file);
            if ($source === false) {
                throw new RuntimeException("Cannot read request source: {$file}");
            }
            foreach ($this->classesIn($source) as $class) {
                if (! class_exists($class)) {
                    require_once $file;
                }
                if (is_subclass_of($class, FormRequest::class) && ! (new ReflectionClass($class))->isAbstract()) {
                    $classes[$class] = true;
                }
            }
        }
        ksort($classes);

        return array_keys($classes);
    }

    private static function globRegex(string $pattern): string
    {
        $regex = '';
        for ($index = 0; $index < strlen($pattern); $index++) {
            $char = $pattern[$index];
            if (substr($pattern, $index, 3) === '**/') {
                $regex .= '(?:[^/]+/)*';
                $index += 2;
            } elseif (substr($pattern, $index, 2) === '**') {
                $regex .= '.*';
                $index++;
            } elseif ($char === '*') {
                $regex .= '[^/]*';
            } elseif ($char === '?') {
                $regex .= '[^/]';
            } elseif ($char === '[' && ($end = strpos($pattern, ']', $index + 1)) !== false) {
                $class = substr($pattern, $index + 1, $end - $index - 1);
                $regex .= '['.str_replace(['!', '~'], ['^', '\\~'], $class).']';
                $index = $end;
            } else {
                $regex .= preg_quote($char, '~');
            }
        }

        return '~^'.$regex.'$~D';
    }

    /** @return list<string> */
    private function classesIn(string $source): array
    {
        $tokens = token_get_all($source);
        $namespace = '';
        $classes = [];
        foreach ($tokens as $index => $token) {
            if (! is_array($token)) {
                continue;
            }
            if ($token[0] === T_NAMESPACE) {
                $namespace = '';
                for ($cursor = $index + 1; isset($tokens[$cursor]); $cursor++) {
                    $part = $tokens[$cursor];
                    if ($part === ';' || $part === '{') {
                        break;
                    }
                    if (is_array($part) && in_array($part[0], [T_STRING, T_NAME_QUALIFIED, T_NS_SEPARATOR], true)) {
                        $namespace .= $part[1];
                    }
                }
            }
            if ($token[0] === T_CLASS) {
                for ($cursor = $index + 1; isset($tokens[$cursor]); $cursor++) {
                    $part = $tokens[$cursor];
                    if (is_array($part) && $part[0] === T_WHITESPACE) {
                        continue;
                    }
                    if (is_array($part) && $part[0] === T_STRING) {
                        $classes[] = ($namespace === '' ? '' : $namespace.'\\').$part[1];
                    }
                    break;
                }
            }
        }

        return $classes;
    }
}
