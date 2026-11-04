<?php

declare(strict_types=1);

namespace Formbraid\Laravel;

use RuntimeException;
use stdClass;

/** The JSON-only inspector type contract, including structural read/write compatibility. */
final class TypeShape
{
    /** @var array<array-key, array{required: bool, type: self}> */
    public array $properties = [];

    /** @var list<self> */
    public array $alternatives = [];

    public ?self $items = null;

    public ?self $additionalProperties = null;

    public ?self $numericProperties = null;

    public bool $tuple = false;

    public bool $readonly = false;

    public bool $implicitIndex = true;

    public function __construct(public string $kind, public mixed $value = null) {}

    public static function from(mixed $value): self
    {
        if (! $value instanceof stdClass || ! isset($value->kind) || ! is_string($value->kind) ||
            ! in_array($value->kind, ['string', 'number', 'boolean', 'null', 'undefined', 'file', 'object', 'array', 'union', 'literal', 'unknown', 'unsupported', 'function'], true)) {
            throw new RuntimeException('Invalid metadata TypeShape.');
        }
        $shape = new self($value->kind, $value->value ?? null);
        if ($shape->kind === 'literal' && (! property_exists($value, 'value') || ! is_scalar($value->value) && $value->value !== null)) {
            throw new RuntimeException('Invalid metadata literal type.');
        }
        foreach (['tuple', 'readonly', 'implicitIndex'] as $flag) {
            if (property_exists($value, $flag)) {
                if (! is_bool($value->{$flag})) {
                    throw new RuntimeException("Invalid metadata {$flag} flag.");
                }
                $shape->{$flag} = $value->{$flag};
            }
        }
        foreach (['items', 'additionalProperties', 'numericProperties'] as $child) {
            if (property_exists($value, $child)) {
                $shape->{$child} = self::from($value->{$child});
            }
        }
        if (property_exists($value, 'properties')) {
            $shape->properties = self::props($value->properties);
        }
        if (property_exists($value, 'alternatives')) {
            if (! is_array($value->alternatives) || ! array_is_list($value->alternatives)) {
                throw new RuntimeException('Invalid metadata union alternatives.');
            }
            $shape->alternatives = array_map(self::from(...), $value->alternatives);
        }
        if ($shape->kind === 'union' && $shape->alternatives === []) {
            throw new RuntimeException('Metadata unions require alternatives.');
        }

        return $shape;
    }

    /** @return array<array-key, array{required: bool, type: self}> */
    public static function props(mixed $value): array
    {
        if (! $value instanceof stdClass) {
            throw new RuntimeException('Metadata props must be an object.');
        }
        $props = [];
        foreach (get_object_vars($value) as $name => $prop) {
            if (! $prop instanceof stdClass || ! isset($prop->required) || ! is_bool($prop->required) || ! isset($prop->type)) {
                throw new RuntimeException("Invalid metadata prop {$name}.");
            }
            $props[$name] = ['required' => $prop->required, 'type' => self::from($prop->type)];
        }

        return $props;
    }

    public function accepts(mixed $value): bool
    {
        if ($this->kind === 'unknown') {
            return true;
        }
        if ($this->kind === 'union') {
            return collect($this->alternatives)->contains(fn (self $type): bool => $type->accepts($value));
        }
        if ($this->kind === 'literal') {
            return self::literalEquals($value, $this->value);
        }
        if ($this->kind === 'array') {
            return ! $this->tuple && is_array($value) && array_is_list($value) &&
                collect($value)->every(fn (mixed $item): bool => $this->items === null || $this->items->accepts($item));
        }
        if ($this->kind === 'object') {
            if (! $value instanceof stdClass) {
                return false;
            }
            $values = get_object_vars($value);
            foreach ($this->properties as $name => $prop) {
                if (! array_key_exists($name, $values)) {
                    if ($prop['required']) {
                        return false;
                    }
                } elseif (! $prop['type']->accepts($values[$name])) {
                    return false;
                }
            }
            foreach ($values as $name => $item) {
                if ($this->additionalProperties !== null && ! $this->additionalProperties->accepts($item) ||
                    self::numericName((string) $name) && $this->numericProperties !== null && ! $this->numericProperties->accepts($item)) {
                    return false;
                }
            }

            return true;
        }

        return match ($this->kind) {
            'string' => is_string($value),
            'number' => is_int($value) || is_float($value),
            'boolean' => is_bool($value),
            'null' => $value === null,
            default => false,
        };
    }

    public function assignableTo(self $target): bool
    {
        if ($this->kind === 'unsupported' || $target->kind === 'unsupported') {
            return false;
        }
        if ($target->kind === 'unknown') {
            return true;
        }
        if ($this->kind === 'union') {
            return collect($this->alternatives)->every(fn (self $member): bool => $member->assignableTo($target));
        }
        if ($target->kind === 'union') {
            if ($this->kind === 'boolean') {
                return (new self('literal', false))->assignableTo($target) && (new self('literal', true))->assignableTo($target);
            }

            return $this->assignableUnion($target->alternatives);
        }
        if ($this->kind === 'literal') {
            return $target->kind === 'literal' ? self::literalEquals($this->value, $target->value) : $target->accepts($this->value);
        }
        if ($this->kind !== $target->kind) {
            return false;
        }
        if ($this->kind === 'array') {
            return ! $this->tuple && ! $target->tuple && (! $this->readonly || $target->readonly) &&
                ($this->items ?? new self('unknown'))->assignableTo($target->items ?? new self('unknown'));
        }
        if ($this->kind !== 'object') {
            return true;
        }
        foreach ($target->properties as $name => $prop) {
            $actual = $this->properties[$name] ?? null;
            if ($actual === null) {
                $index = self::numericName((string) $name) ? ($this->numericProperties ?? $this->additionalProperties) : $this->additionalProperties;
                if ($prop['required'] || $index !== null && ! $index->assignableTo($prop['type'])) {
                    return false;
                }
            } elseif ($prop['required'] && ! $actual['required'] || ! $actual['type']->assignableTo($prop['type'])) {
                return false;
            }
        }

        return $this->assignableIndex($target->additionalProperties, false) && $this->assignableIndex($target->numericProperties, true);
    }

    /** @param list<self> $alternatives */
    private function assignableUnion(array $alternatives): bool
    {
        if (collect($alternatives)->contains(fn (self $member): bool => $this->assignableTo($member))) {
            return true;
        }
        if ($this->kind !== 'object' || collect($alternatives)->contains(static fn (self $member): bool => $member->kind !== 'object')) {
            return false;
        }
        $variants = [$this];
        foreach ($this->properties as $name => $property) {
            $literals = $property['type']->literalVariants();
            if (! $property['required'] || $literals === null || count($literals) <= 1 ||
                ! collect($alternatives)->every(static fn (self $member): bool => isset($member->properties[$name]) && $member->properties[$name]['required'] && $member->properties[$name]['type']->literalVariants() !== null) ||
                ! collect($alternatives)->contains(static fn (self $member): bool => ! $property['type']->assignableTo($member->properties[$name]['type']))) {
                continue;
            }
            if (count($variants) * count($literals) > 25) {
                return false;
            }
            $next = [];
            foreach ($variants as $variant) {
                foreach ($literals as $literal) {
                    $copy = clone $variant;
                    $copy->properties[$name] = ['required' => true, 'type' => $literal];
                    $next[] = $copy;
                }
            }
            $variants = $next;
        }

        return count($variants) > 1 && collect($variants)->every(static fn (self $variant): bool => collect($alternatives)->contains(static fn (self $member): bool => $variant->assignableTo($member)));
    }

    /** @return list<self>|null */
    private function literalVariants(): ?array
    {
        if ($this->kind === 'boolean') {
            return [new self('literal', false), new self('literal', true)];
        }
        if (in_array($this->kind, ['literal', 'null'], true)) {
            return [$this];
        }
        if ($this->kind !== 'union') {
            return null;
        }
        $variants = [];
        foreach ($this->alternatives as $member) {
            $literals = $member->literalVariants();
            if ($literals === null) {
                return null;
            }
            array_push($variants, ...$literals);
        }

        return $variants;
    }

    private function assignableIndex(?self $index, bool $numeric): bool
    {
        if ($index === null) {
            return true;
        }
        foreach ($this->properties as $name => $property) {
            if ((! $numeric || self::numericName((string) $name)) && ! $property['type']->assignableTo($index)) {
                return false;
            }
        }
        $effective = $numeric ? ($this->numericProperties ?? $this->additionalProperties) : $this->additionalProperties;

        return ($effective === null ? $this->implicitIndex : $effective->assignableTo($index)) &&
            ($numeric || $this->numericProperties === null || $this->numericProperties->assignableTo($index));
    }

    public function inspectable(): bool
    {
        return $this->kind !== 'unsupported' && ! $this->tuple &&
            collect($this->alternatives)->every(static fn (self $type): bool => $type->inspectable()) &&
            ($this->items === null || $this->items->inspectable()) &&
            ($this->additionalProperties === null || $this->additionalProperties->inspectable()) &&
            ($this->numericProperties === null || $this->numericProperties->inspectable()) &&
            collect($this->properties)->every(static fn (array $prop): bool => $prop['type']->inspectable());
    }

    public function typescript(): string
    {
        return match ($this->kind) {
            'literal' => self::literal($this->value),
            'file' => 'File',
            'union' => implode(' | ', array_map(static fn (self $type): string => $type->typescript(), $this->alternatives)) ?: 'never',
            'array' => 'Array<'.($this->items ?? new self('unknown'))->typescript().'>',
            'object' => $this->objectType(),
            default => $this->kind,
        };
    }

    private function objectType(): string
    {
        if ($this->properties === []) {
            return 'Record<string, '.($this->additionalProperties ?? new self('unknown'))->typescript().'>';
        }
        $parts = [];
        foreach ($this->properties as $name => $prop) {
            $parts[] = self::literal((string) $name).($prop['required'] ? '' : '?').': '.$prop['type']->typescript().';';
        }

        return '{ '.implode(' ', $parts).' }';
    }

    public static function literal(mixed $value, bool $pretty = false): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR | JSON_HEX_TAG | JSON_UNESCAPED_SLASHES | ($pretty ? JSON_PRETTY_PRINT : 0));
    }

    private static function literalEquals(mixed $left, mixed $right): bool
    {
        return $left === $right || (is_int($left) || is_float($left)) && (is_int($right) || is_float($right)) && $left == $right;
    }

    private static function numericName(string $name): bool
    {
        return is_numeric($name) && (string) (0 + $name) === $name;
    }
}
