<?php

declare(strict_types=1);

namespace Formbraid\Laravel;

use InvalidArgumentException;

/** A symbolic operand; constructing one never reads a request or form. */
final readonly class OptionInput
{
    private function __construct(public string $kind, public ?string $path = null, public ?string $key = null) {}

    public static function value(): self
    {
        return new self('value');
    }

    public static function field(string $path): self
    {
        if ($path === '') {
            throw new InvalidArgumentException('An option field reference requires a path.');
        }

        return new self('field', path: $path);
    }

    public static function context(string $key): self
    {
        if ($key === '') {
            throw new InvalidArgumentException('An option context reference requires a key.');
        }

        return new self('context', key: $key);
    }

    /** @return array{kind: string, path?: string, key?: string} */
    public function toArray(): array
    {
        return array_filter(['kind' => $this->kind, 'path' => $this->path, 'key' => $this->key], static fn (?string $value): bool => $value !== null);
    }
}
