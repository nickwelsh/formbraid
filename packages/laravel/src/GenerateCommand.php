<?php

declare(strict_types=1);

namespace Formbraid\Laravel;

use Formbraid\Laravel\Contracts\SubmissionDriver;
use Illuminate\Console\Command;
use Illuminate\Routing\Router;
use RuntimeException;

final class GenerateCommand extends Command
{
    protected $signature = 'formbraid:generate';

    protected $description = 'Generate Laravel form modules from existing Formbraid component metadata';

    public function handle(Router $router): int
    {
        try {
            $config = config('formbraid');
            if (! is_array($config)) {
                throw new RuntimeException('Missing Formbraid configuration.');
            }
            $metadataPath = GeneratedFiles::path($config['metadata'] ?? null, 'metadata');
            $output = GeneratedFiles::path($config['output'] ?? null, 'output');
            $enumPath = GeneratedFiles::path($config['component_enum'] ?? null, 'component_enum');
            if (! str_ends_with($enumPath, '.php')) {
                throw new RuntimeException('formbraid.component_enum must be a PHP file path.');
            }
            $metadata = ComponentMetadata::read(base_path($metadataPath));
            $driverClass = $config['submission_driver'] ?? null;
            if (! is_string($driverClass) || ! is_subclass_of($driverClass, SubmissionDriver::class)) {
                throw new RuntimeException('formbraid.submission_driver must be a class implementing '.SubmissionDriver::class.'.');
            }
            $driver = app()->make($driverClass);
            if (! $driver instanceof SubmissionDriver) {
                throw new RuntimeException('The configured submission driver must implement '.SubmissionDriver::class.'.');
            }
            $enum = ComponentEnum::generate($enumPath, $metadata);
            $enum->load();
            $configuration = Configuration::from($config);
            $classes = (new RequestDiscovery)->discover($configuration->requests);
            $extractor = new RequestExtractor($configuration);
            $emitter = new FormEmitter($metadata);
            $files = [$enumPath => $enum->source];
            foreach ($classes as $class) {
                // Container resolution would execute Laravel's authorization/validation hooks.
                $request = $class::createFrom(request(), new $class);
                $request->setContainer(app());
                try {
                    $extracted = $extractor->extract($request);
                    $files[$output.'/requests/'.FormEmitter::path($class)] = $emitter->emit($extracted['form']);
                } catch (\Throwable $error) {
                    throw new RuntimeException("Cannot generate {$class}: {$error->getMessage()}", previous: $error);
                }
                foreach ($extracted['diagnostics'] as $diagnostic) {
                    $this->warn($diagnostic);
                }
            }
            foreach ((new ControllerEmitter($driver))->emit($router, $classes) as $path => $source) {
                $files[$output.'/'.$path] = $source;
            }
            (new GeneratedFiles($output, $enumPath))->publish($files);
            $this->info('Generated '.count($classes).' Formbraid request definitions and their controller forms.');

            return self::SUCCESS;
        } catch (\Throwable $error) {
            $this->error($error->getMessage());

            return self::FAILURE;
        }
    }
}
