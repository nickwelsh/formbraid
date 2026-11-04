<?php

declare(strict_types=1);

namespace Formbraid\Laravel\Drivers;

final class Fetch extends TemplateDriver
{
    protected function template(): string
    {
        return 'fetch.ts.stub';
    }
}
