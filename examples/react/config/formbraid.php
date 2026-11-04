<?php

declare(strict_types=1);
use Formbraid\Laravel\Drivers\Fetch;

return [
    'requests' => ['php/**/*Request.php'],
    'metadata' => 'src/_metadata.json',
    'output' => 'src/generated',
    'component_enum' => 'php/Enums/FormField.php',
    'submission_driver' => Fetch::class,
    'fields' => [
        'types' => ['string' => 'TextField', 'boolean' => 'CheckboxField'],
        'rules' => ['email' => ['component' => 'TextField', 'props' => ['type' => 'email']]],
        'fallbackType' => 'string',
    ],
];
