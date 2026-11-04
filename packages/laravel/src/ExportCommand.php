<?php

declare(strict_types=1);

namespace Formbraid\Laravel;

use Illuminate\Console\Command;

final class ExportCommand extends Command
{
    protected $signature = 'formbraid:export {--profile= : Backend discovery profile}';

    protected $description = 'Export Laravel form definitions as the portable Formbraid JSON contract';

    public function handle(): int
    {
        $config = config('formbraid');
        if (! is_array($config)) {
            throw new \RuntimeException('Missing Formbraid configuration.');
        }
        $profile = $this->option('profile');
        if (is_string($profile) && $profile !== '') {
            $profiles = $config['profiles'] ?? [];
            if (! is_array($profiles) || ! isset($profiles[$profile]) || ! is_array($profiles[$profile])) {
                throw new \RuntimeException("Unknown Formbraid profile: {$profile}");
            }
            $config = array_replace($config, $profiles[$profile]);
        }
        $configuration = Configuration::from($config);
        $extractor = new RequestExtractor($configuration);
        $classes = (new RequestDiscovery)->discover($configuration->requests);
        $forms = [];
        $diagnostics = [];
        foreach ($classes as $class) {
            // Avoid container resolution: it would trigger FormRequest validation/authorization.
            $request = $class::createFrom(request(), new $class);
            $request->setContainer(app());
            try {
                $extracted = $extractor->extract($request);
            } catch (\Throwable $error) {
                throw new \RuntimeException("Cannot export {$class}: {$error->getMessage()}. Generation needs rules that can be described without live request data.", previous: $error);
            }
            $forms[] = $extracted['form'];
            $diagnostics = array_merge($diagnostics, $extracted['diagnostics']);
        }
        $this->line(json_encode(['version' => 1, 'forms' => $forms, 'diagnostics' => $diagnostics], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        return self::SUCCESS;
    }
}
