<?php

declare(strict_types=1);

namespace Formbraid\Laravel;

use RuntimeException;
use stdClass;

/** @phpstan-type ComponentInfo array{props: array<array-key, array{required: bool, type: TypeShape}>, slots: array<array-key, TypeShape>|null} */
final readonly class ComponentMetadata
{
    /**
     * @param  array<array-key, ComponentInfo>  $fields
     * @param  array<array-key, ComponentInfo>  $components
     * @param  array<array-key, ComponentInfo>  $groups
     */
    public function __construct(public array $fields, public array $components, public array $groups) {}

    public static function read(string $path): self
    {
        if (! is_file($path) || ! is_readable($path)) {
            throw new RuntimeException("Formbraid metadata is missing or unreadable: {$path}. Produce metadata with the frontend tooling first.");
        }
        try {
            $source = file_get_contents($path);
            if ($source === false) {
                throw new RuntimeException('Cannot read metadata.');
            }
            $json = json_decode($source, flags: JSON_THROW_ON_ERROR);
            if (! $json instanceof stdClass || ($json->version ?? null) !== 1 || ! isset($json->inputs) || ! is_array($json->inputs) ||
                ! array_is_list($json->inputs) || count(array_filter($json->inputs, is_string(...))) !== count($json->inputs)) {
                throw new RuntimeException('Expected version 1 metadata with inputs, fields, components and groups.');
            }

            return new self(self::registry($json->fields ?? null), self::registry($json->components ?? null), self::registry($json->groups ?? null));
        } catch (\Throwable $error) {
            throw new RuntimeException("Invalid Formbraid metadata at {$path}: {$error->getMessage()}", previous: $error);
        }
    }

    /** @return array<array-key, ComponentInfo> */
    private static function registry(mixed $value): array
    {
        if (! $value instanceof stdClass) {
            throw new RuntimeException('Component registries must be objects.');
        }
        $registry = [];
        foreach (get_object_vars($value) as $name => $component) {
            if ($name === '' || ! $component instanceof stdClass) {
                throw new RuntimeException('Invalid component metadata.');
            }
            $slots = null;
            if (property_exists($component, 'slots')) {
                if (! $component->slots instanceof stdClass) {
                    throw new RuntimeException('Component slots must be an object.');
                }
                $slots = [];
                foreach (get_object_vars($component->slots) as $slot => $type) {
                    $slots[$slot] = TypeShape::from($type);
                }
            }
            $registry[$name] = ['props' => TypeShape::props($component->props ?? null), 'slots' => $slots];
        }

        return $registry;
    }
}
