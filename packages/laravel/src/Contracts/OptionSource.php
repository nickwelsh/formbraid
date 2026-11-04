<?php

declare(strict_types=1);

namespace Formbraid\Laravel\Contracts;

use Formbraid\Laravel\OptionInput;

/** Build-time declaration only. Providers discover references from their own expressions. */
interface OptionSource
{
    /** @return list<OptionInput> Discovered listing dependencies. */
    public function inputs(): array;

    /** @return list<OptionInput> Discovered selected-ID resolution dependencies. */
    public function resolveInputs(): array;
}
