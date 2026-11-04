<?php

declare(strict_types=1);
use Formbraid\Laravel\Drivers\Fetch;

return [
    'requests' => ['app/Http/Requests'],
    'metadata' => 'resources/js/formbraid/_metadata.json',
    'output' => 'resources/js/formbraid/laravel',
    'component_enum' => 'app/Formbraid/FormField.php',
    // Any class implementing Formbraid\Laravel\Contracts\SubmissionDriver may be resolved through the container.
    'submission_driver' => Fetch::class,
    'profiles' => [],
    'fields' => [
        // Strings bootstrap the first metadata pass; generated App\Formbraid\FormField cases work too.
        'types' => [
            'string' => 'TextField',
            'integer' => 'NumberField',
            'number' => 'NumberField',
            'boolean' => 'CheckboxField',
            'date' => 'DateField',
            'enum' => 'SelectField',
            'file' => 'FileField',
        ],
        'rules' => [
            'email' => ['component' => 'TextField', 'props' => ['type' => 'email']],
            'url' => ['component' => 'TextField', 'props' => ['type' => 'url']],
        ],
        // Used only when no rule establishes a value type.
        'fallbackType' => 'string',
    ],
];
