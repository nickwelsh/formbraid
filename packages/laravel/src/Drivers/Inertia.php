<?php

declare(strict_types=1);

namespace Formbraid\Laravel\Drivers;

final class Inertia extends TemplateDriver
{
    protected function template(): string
    {
        return 'inertia.ts.stub';
    }
}
