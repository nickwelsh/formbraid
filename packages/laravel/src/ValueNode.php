<?php

declare(strict_types=1);

namespace Formbraid\Laravel;

use RuntimeException;

final class ValueNode
{
    /** @var array<array-key, self> */
    public array $children = [];

    public ?TypeShape $type = null;

    public ?bool $array = null;

    /** @param list<string> $segments */
    public function insert(array $segments, TypeShape $type, ?bool $array): void
    {
        $node = $this;
        foreach ($segments as $segment) {
            $node->children[$segment] ??= new self;
            $node = $node->children[$segment];
        }
        $node->type = $type;
        $node->array = $array;
    }

    /** @param list<mixed> $samples */
    public function resolve(array $samples): void
    {
        $this->array ??= count(array_filter($samples, is_array(...))) > 0 || isset($this->children['*']);
        if ($this->array) {
            $children = $this->children;
            $this->children = [];
            foreach ($children as $segment => $child) {
                if ($segment !== '*' && ! ctype_digit((string) $segment)) {
                    throw new RuntimeException("Invalid array child: {$segment}.");
                }
                if ($segment !== '*' && (float) $segment > 9007199254740991) {
                    throw new RuntimeException("Invalid array index: {$segment}.");
                }
                $key = $segment === '*' ? '*' : (string) (int) $segment;
                if (isset($this->children[$key])) {
                    $this->children[$key]->merge($child);
                } else {
                    $this->children[$key] = $child;
                }
            }
        }
        foreach ($this->children as $segment => $child) {
            $nested = [];
            foreach ($samples as $sample) {
                if ($segment === '*') {
                    if (is_array($sample)) {
                        array_push($nested, ...array_values($sample));
                    }
                } elseif (is_array($sample)) {
                    $key = ctype_digit((string) $segment) ? (string) (int) $segment : $segment;
                    if (array_key_exists($key, $sample)) {
                        $nested[] = $sample[$key];
                    }
                } elseif ($sample instanceof \stdClass && property_exists($sample, (string) $segment)) {
                    $nested[] = $sample->{$segment};
                }
            }
            $child->resolve($nested);
        }
    }

    private function merge(self $incoming): void
    {
        if ($this->type !== null && $incoming->type !== null && $this->type->typescript() !== $incoming->type->typescript()) {
            throw new RuntimeException('Conflicting types for equivalent field paths.');
        }
        $this->type ??= $incoming->type;
        $this->array ??= $incoming->array;
        foreach ($incoming->children as $name => $child) {
            if (isset($this->children[$name])) {
                $this->children[$name]->merge($child);
            } else {
                $this->children[$name] = $child;
            }
        }
    }

    public function nullable(): bool
    {
        return $this->type?->kind === 'union' && count(array_filter($this->type->alternatives, static fn (TypeShape $type): bool => $type->kind === 'null')) > 0;
    }

    public function shape(): TypeShape
    {
        if ($this->children === []) {
            return $this->type ?? new TypeShape('unknown');
        }
        if ($this->array) {
            $shape = new TypeShape('array');
            $items = [];
            foreach ($this->children as $child) {
                $item = $child->shape();
                $items[$item->typescript()] = $item;
            }
            $shape->items = count($items) === 1 ? array_values($items)[0] : new TypeShape('union');
            if (count($items) > 1) {
                $shape->items->alternatives = array_values($items);
            }
        } else {
            $shape = new TypeShape('object');
            foreach ($this->children as $name => $child) {
                $shape->properties[$name] = ['required' => true, 'type' => $child->shape()];
            }
        }
        if (! $this->nullable()) {
            return $shape;
        }
        $nullable = new TypeShape('union');
        $nullable->alternatives = [$shape, new TypeShape('null')];

        return $nullable;
    }

    public function writable(string $path): ?self
    {
        $node = $this;
        foreach (explode('.', $path) as $segment) {
            if ($node->nullable() || $node->array || ! isset($node->children[$segment])) {
                return null;
            }
            $node = $node->children[$segment];
        }

        return $node;
    }
}
