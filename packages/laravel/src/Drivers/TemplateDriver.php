<?php

declare(strict_types=1);

namespace Formbraid\Laravel\Drivers;

use Formbraid\Laravel\Contracts\SubmissionDriver;
use InvalidArgumentException;
use RuntimeException;

/** @internal */
abstract class TemplateDriver implements SubmissionDriver
{
    abstract protected function template(): string;

    final public function generate(string $endpoint, string $method): string
    {
        $method = strtolower($method);
        if (! in_array($method, ['get', 'post', 'put', 'patch', 'delete'], true)) {
            throw new InvalidArgumentException("Unsupported submission method: {$method}");
        }
        $source = file_get_contents(__DIR__.'/../../stubs/drivers/'.$this->template());
        if ($source === false) {
            throw new RuntimeException('Cannot read the Formbraid submission driver template.');
        }
        $errors = file_get_contents(__DIR__.'/../../stubs/drivers/errors.ts.stub');
        if ($errors === false) {
            throw new RuntimeException('Cannot read the Formbraid validation errors schema.');
        }

        return strtr(trim($source), [
            '__FORMBRAID_ENDPOINT__' => $endpoint,
            '__FORMBRAID_METHOD__' => json_encode($method, JSON_THROW_ON_ERROR),
            '__FORMBRAID_ERRORS_SCHEMA__' => str_replace("\n", "\n        ", trim($errors)),
        ]);
    }
}
