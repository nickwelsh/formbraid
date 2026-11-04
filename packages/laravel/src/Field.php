<?php

declare(strict_types=1);

namespace Formbraid\Laravel;

use BackedEnum;
use Formbraid\Laravel\Contracts\OptionSource;

final class Field
{
    /** @var array{component?: string|int, label?: string, helpText?: string, type?: string, props?: array<string, mixed>, options?: array<mixed>|OptionSource} */
    private array $metadata = [];

    public static function make(BackedEnum|string|null $component = null): self
    {
        $field = new self;
        if ($component !== null) {
            $field->metadata['component'] = $component instanceof BackedEnum ? $component->value : $component;
        }

        return $field;
    }

    public function label(string $label): self
    {
        $this->metadata['label'] = $label;

        return $this;
    }

    public function helpText(string $text): self
    {
        $this->metadata['helpText'] = $text;

        return $this;
    }

    public function type(string $type): self
    {
        $this->metadata['type'] = $type;

        return $this;
    }

    /** @param array<string, mixed> $props */
    public function props(array $props): self
    {
        $this->metadata['props'] = array_replace($this->metadata['props'] ?? [], $props);

        return $this;
    }

    /** @param list<array{value: string|int|float, label: string, disabled?: bool}>|OptionSource $options */
    public function options(array|OptionSource $options): self
    {
        $this->metadata['options'] = $options;

        return $this;
    }

    /** @return array{component?: string|int, label?: string, helpText?: string, type?: string, props?: array<string, mixed>, options?: array<mixed>|OptionSource} */
    public function toArray(): array
    {
        return $this->metadata;
    }
}
