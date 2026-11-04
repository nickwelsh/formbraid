<?php

declare(strict_types=1);

namespace Formbraid\Laravel\Tests;

use Formbraid\Laravel\FormbraidServiceProvider;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\Artisan;
use Orchestra\Testbench\TestCase;

final class InitCommandTest extends TestCase
{
    private string $root;

    private string $originalBase;

    protected function getPackageProviders($app): array
    {
        return [FormbraidServiceProvider::class];
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->originalBase = $this->app->basePath();
        $this->root = sys_get_temp_dir().'/formbraid-init-'.bin2hex(random_bytes(8));
        mkdir($this->root);
        $this->app->setBasePath($this->root);
    }

    protected function tearDown(): void
    {
        $this->app->setBasePath($this->originalBase);
        (new Filesystem)->deleteDirectory($this->root);
        parent::tearDown();
    }

    private function initialize(array $options = []): string
    {
        $exit = Artisan::call('formbraid:init', $options);
        $output = Artisan::output();
        self::assertSame(0, $exit, $output);

        return $output;
    }

    public function test_scaffolds_once_without_node_metadata_or_generated_enum(): void
    {
        config(['formbraid.requests' => ['app/Modules/**/Requests/**/*.php']]);
        $path = getenv('PATH');
        putenv('PATH=/no-frontend-tools');
        try {
            self::assertStringContainsString('Start Vite once', $this->initialize());
            self::assertFileExists($this->root.'/resources/js/formbraid/index.ts');
            self::assertFileExists($this->root.'/config/formbraid.php');
            self::assertFileDoesNotExist($this->root.'/resources/js/formbraid/_metadata.json');
            self::assertFileDoesNotExist($this->root.'/app/Formbraid/FormField.php');
            $integration = file_get_contents($this->root.'/resources/js/formbraid/laravel.ts');
            self::assertStringContainsString('app/Modules/**/Requests/**/*.php', $integration);
            self::assertStringNotContainsString('from \'./index', $integration);
            file_put_contents($this->root.'/resources/js/formbraid/index.ts', 'user configuration');
            file_put_contents($this->root.'/config/formbraid.php', '<?php // user configuration');
            $this->initialize();
            self::assertSame('user configuration', file_get_contents($this->root.'/resources/js/formbraid/index.ts'));
            self::assertSame('<?php // user configuration', file_get_contents($this->root.'/config/formbraid.php'));
            self::assertSame(1, substr_count(file_get_contents($this->root.'/.gitignore'), '/resources/js/formbraid/_metadata.json'));
        } finally {
            putenv('PATH='.$path);
        }
    }

    public function test_registers_conventional_vite_config_once_and_preserves_other_plugins(): void
    {
        $original = "import { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [laravel({ input: ['resources/js/app.tsx'] }), react()] });\n";
        file_put_contents($this->root.'/vite.config.ts', $original);
        $this->initialize(['--register-vite' => true]);
        $registered = file_get_contents($this->root.'/vite.config.ts');
        self::assertStringContainsString('formbraid({ integrations: [laravelForms] })', $registered);
        self::assertStringContainsString("laravel({ input: ['resources/js/app.tsx'] }), react()", $registered);
        $this->initialize(['--register-vite' => true]);
        self::assertSame($registered, file_get_contents($this->root.'/vite.config.ts'));
    }

    public function test_complex_configs_are_not_rewritten_and_receive_manual_instructions(): void
    {
        foreach ([
            'export default defineConfig(({ mode }) => ({ plugins: makePlugins(mode) }));',
            'export default defineConfig({ resolve: {}, plugins: [] });',
            'const help = "export default defineConfig({ plugins: ["; export default other;',
            '// export default defineConfig({ plugins: [',
            'const pattern = /plugins: [/; export default defineConfig({ plugins: [] });',
        ] as $original) {
            file_put_contents($this->root.'/vite.config.ts', $original);
            $output = $this->initialize(['--register-vite' => true]);
            self::assertSame($original, file_get_contents($this->root.'/vite.config.ts'));
            self::assertStringContainsString('Add these imports', $output);
        }
    }

    public function test_custom_metadata_output_paths_are_reflected_in_scaffold(): void
    {
        config(['formbraid.metadata' => 'frontend/forms/_metadata.json', 'formbraid.output' => 'frontend/generated', 'formbraid.component_enum' => 'app/Enums/Components.php']);
        $output = $this->initialize();
        self::assertFileExists($this->root.'/frontend/forms/index.ts');
        $integration = file_get_contents($this->root.'/frontend/forms/laravel.ts');
        self::assertStringContainsString('frontend/generated/**', $integration);
        self::assertStringContainsString('app/Enums/Components.php', $integration);
        self::assertStringContainsString('./frontend/forms/laravel', $output);
    }
}
