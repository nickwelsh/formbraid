<?php

declare(strict_types=1);

namespace Formbraid\Laravel\Contracts;

interface SubmissionDriver
{
    /** Return a TypeScript SubmissionCallback expression. $endpoint is a TypeScript expression, not an unescaped literal. */
    public function generate(string $endpoint, string $method): string;
}
