<?php

declare(strict_types=1);

namespace Formbraid\Laravel\Tests;

use Formbraid\Laravel\ComponentMetadata;
use Formbraid\Laravel\Contracts\SubmissionDriver;
use Formbraid\Laravel\FormbraidServiceProvider;
use Formbraid\Laravel\FormEmitter;
use Formbraid\Laravel\RequestExtractor;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Route;
use Orchestra\Testbench\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;

final class FixtureSubmissionDriver implements SubmissionDriver
{
    public array $calls = [];

    public function __construct(private string $marker) {}

    public function generate(string $endpoint, string $method): string
    {
        $this->calls[] = [$endpoint, $method];

        return '(values, context) => { void values; void context; void '.$endpoint.'; void '.json_encode($method).'; /* '.$this->marker.' */ return { status: "success" }; }';
    }
}

final class GenerateCommandTest extends TestCase
{
    private string $root;

    private string $originalBase;

    private string $namespace;

    private FixtureSubmissionDriver $driver;

    protected function getPackageProviders($app): array
    {
        return [FormbraidServiceProvider::class];
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->originalBase = $this->app->basePath();
        $id = bin2hex(random_bytes(8));
        $this->namespace = 'Generation'.$id;
        $this->root = sys_get_temp_dir().'/formbraid-php-'.$id;
        mkdir($this->root);
        $this->app->setBasePath($this->root);
        $this->write('composer.json', json_encode(['autoload' => ['psr-4' => [$this->namespace.'\\' => ['app/']]]], JSON_THROW_ON_ERROR));
        $this->driver = new FixtureSubmissionDriver('resolved through container');
        $this->app->instance(FixtureSubmissionDriver::class, $this->driver);
        config([
            'formbraid.requests' => ['app/Http/Requests/**/*.php'],
            'formbraid.submission_driver' => FixtureSubmissionDriver::class,
            'formbraid.fields.types' => array_fill_keys(['string', 'integer', 'number', 'boolean', 'date', 'enum', 'file', 'array', 'object'], 'Input'),
            'formbraid.fields.rules' => ['email' => ['component' => 'Input', 'props' => ['type' => 'email']]],
        ]);
        $this->metadata();
    }

    protected function tearDown(): void
    {
        $this->app->setBasePath($this->originalBase);
        (new Filesystem)->deleteDirectory($this->root);
        parent::tearDown();
    }

    private function write(string $path, string $contents): void
    {
        $path = $this->root.'/'.$path;
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0755, true);
        }
        file_put_contents($path, $contents);
    }

    private function metadata(array $extraProps = [], array $groups = []): void
    {
        $props = [
            'label' => ['required' => true, 'type' => ['kind' => 'string']],
            'constraints' => ['required' => true, 'type' => ['kind' => 'unknown']],
            'helpText' => ['required' => false, 'type' => ['kind' => 'string']],
            'type' => ['required' => false, 'type' => ['kind' => 'string']],
            ...$extraProps,
        ];
        $this->write('resources/js/formbraid/_metadata.json', json_encode([
            'version' => 1, 'inputs' => ['must-not-be-loaded.tsx'],
            'fields' => ['Input' => ['props' => (object) $props]],
            'components' => ['Submit' => ['props' => (object) []], 'Container' => ['props' => (object) []]],
            'groups' => (object) $groups,
        ], JSON_THROW_ON_ERROR));
    }

    private function request(array $rules = ['name' => 'required|string'], string $fields = 'return [];', string $groups = 'return [];', string $relative = 'ProfileRequest'): string
    {
        $parts = explode('/', $relative);
        $name = array_pop($parts);
        $namespace = $this->namespace.'\\Http\\Requests'.($parts === [] ? '' : '\\'.implode('\\', $parts));
        $rules = var_export($rules, true);
        $this->write('app/Http/Requests/'.$relative.'.php', "<?php\nnamespace {$namespace};\n".
            'use Formbraid\\Laravel\\Field; use Formbraid\\Laravel\\FieldGroup; use '.$this->namespace."\\Formbraid\\FormField;\n".
            "final class {$name} extends \\Illuminate\\Foundation\\Http\\FormRequest {\n".
            "public function authorize(): bool { throw new \\LogicException('must not authorize'); }\n".
            "protected function prepareForValidation(): void { throw new \\LogicException('must not validate'); }\n".
            "public function rules(): array { return {$rules}; }\n".
            "public function fields(): array { {$fields} }\n".
            "public function groups(): array { {$groups} }\n}\n");

        return $namespace.'\\'.$name;
    }

    private function generated(string $path): string
    {
        return file_get_contents($this->root.'/resources/js/formbraid/laravel/'.$path);
    }

    private function succeed(): void
    {
        self::assertSame(0, Artisan::call('formbraid:generate'), Artisan::output());
    }

    private function failWith(string $message): void
    {
        $exit = Artisan::call('formbraid:generate');
        $output = Artisan::output();
        self::assertSame(1, $exit, $output);
        self::assertStringContainsString($message, $output);
    }

    public function test_unsupported_sources_fail_instead_of_generating_unbound_fields(): void
    {
        $request = $this->request(fields: 'return ["name" => Field::make()->options(new class implements \\Formbraid\\Laravel\\Contracts\\OptionSource { public function inputs(): array { return []; } public function resolveInputs(): array { return []; } })];');
        $this->failWith($request.'.name: unsupported option source');
        self::assertFileDoesNotExist($this->root.'/resources/js/formbraid/laravel/requests/'.str_replace('\\', '/', $request).'.ts');
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage("source provider's producer");
        Artisan::call('formbraid:export');
    }

    public function test_static_options_are_emitted_without_changing_finite_validation_or_component_props(): void
    {
        $request = $this->request(['name' => 'string'], 'return ["name" => Field::make()->options([["value" => "a", "label" => "A"]])];');
        $this->succeed();
        $module = $this->generated('requests/'.str_replace('\\', '/', $request).'.ts');
        self::assertStringContainsString('"kind": "static"', $module);
        self::assertStringContainsString('"label": "A"', $module);
        self::assertStringContainsString('"name": string;', $module);
    }

    public function test_provider_producers_can_emit_explicitly_supported_sources_as_portable_metadata(): void
    {
        $class = $this->request(fields: 'return ["name" => Field::make()->options(new class implements \\Formbraid\\Laravel\\Contracts\\OptionSource { public function inputs(): array { return [\\Formbraid\\Laravel\\OptionInput::value()]; } public function resolveInputs(): array { return []; } })];');
        require $this->root.'/app/Http/Requests/ProfileRequest.php';
        $extracted = (new RequestExtractor(config('formbraid')))->extract(new $class);
        $emitter = new FormEmitter(ComponentMetadata::read($this->root.'/resources/js/formbraid/_metadata.json'));
        $module = $emitter->emit($extracted['form'], supportedOptionSources: array_keys($extracted['optionSources']));
        self::assertStringContainsString('"kind": "source"', $module);
        self::assertStringContainsString('"kind": "value"', $module);
        self::assertStringContainsString('"name": string;', $module);
        // A provider must account for every declaration; recognizing a different ID is not sufficient.
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage($class.'.name: unsupported option source');
        $emitter->emit($extracted['form'], supportedOptionSources: ['another:field']);
    }

    public function test_generates_enum_before_fields_and_namespace_preserving_requests_and_controller_descriptors(): void
    {
        $request = $this->request([
            'profile.name' => 'string', 'profile' => 'nullable|array', 'rows' => 'array', 'rows.*.age' => 'required|integer',
            'choice' => 'in:home,work', 'photo' => 'nullable|file', 'email' => 'email',
        ], 'return ["email" => Field::make(FormField::Input)->label('.var_export("</script>\u{2028}\"", true).'), "rows" => Field::make()->helpText("Rows")];');
        $nested = $this->request(relative: 'Admin/ProfileRequest');
        config(['formbraid.requests' => ['app/Http/Requests/**/*.php', 'app/Http/Requests/Admin/*.php', 'app/Http/Requests']]);
        // Reflection may autoload a controller before request discovery, but must never instantiate it.
        $controller = $this->namespace.'\\Http\\Controllers\\Admin\\ProfileController';
        require $this->root.'/app/Http/Requests/ProfileRequest.php';
        $this->write('Controller.php', "<?php namespace {$this->namespace}\\Http\\Controllers\\Admin; final class ProfileController { public function update(\\{$request} \$request): void {} public function store(\\{$request} \$request): void {} }");
        require $this->root.'/Controller.php';
        Route::patch('/users/{user}/{tab?}/quote\'"</script>', [$controller, 'update'])->name('users.update');
        Route::post('/users', [$controller, 'store'])->name('users.store');
        $path = getenv('PATH');
        putenv('PATH=/there-are-no-frontend-tools');
        try {
            $this->succeed();
        } finally {
            putenv($path === false ? 'PATH' : 'PATH='.$path);
        }
        $enum = file_get_contents($this->root.'/app/Formbraid/FormField.php');
        self::assertStringContainsString('namespace '.$this->namespace.'\\Formbraid;', $enum);
        self::assertStringContainsString("case Input = 'Input';", $enum);
        self::assertStringContainsString("case Submit = 'Submit';", $enum);
        $source = $this->generated('requests/'.str_replace('\\', '/', $request).'.ts');
        self::assertStringContainsString('import { defineForm } from \'@formbraid/core\';', $source);
        self::assertStringContainsString('"profile": { "name": string; } | null;', $source);
        self::assertStringContainsString('"rows": Array<{ "age": number; }>', $source);
        self::assertStringContainsString('"choice": "home" | "work" | "";', $source);
        self::assertStringContainsString('"photo": File | null;', $source);
        self::assertStringContainsString('\\u003C/script\\u003E\\u2028\\"', $source);
        self::assertStringContainsString('"type": "email"', $source);
        self::assertStringContainsString('defineForm<ProfileRequestValues>()', $source);
        self::assertFileExists($this->root.'/resources/js/formbraid/laravel/requests/'.str_replace('\\', '/', $nested).'.ts');
        $actions = $this->generated('controllers/'.str_replace('\\', '/', $controller).'.ts');
        self::assertStringContainsString('parameters: { "user": string | number; "tab"?: string | number; }', $actions);
        self::assertStringContainsString('submission: { submit: (values, context)', $actions);
        self::assertStringContainsString('satisfies FormDescriptor<', $actions);
        self::assertStringContainsString('export { _action_update as update };', $actions);
        self::assertStringContainsString('const _action_store = ({ version:', $actions);
        self::assertStringContainsString('resolved through container', $actions);
        self::assertStringNotContainsString('</script>', $actions);
        self::assertSame(['routeUrl("users", {})', 'post'], $this->driver->calls[0]);
        self::assertStringContainsString('parameters)', $this->driver->calls[1][0]);
        self::assertSame('patch', $this->driver->calls[1][1]);
        $before = $this->generated('.formbraid-manifest.json');
        $this->succeed();
        self::assertSame($before, $this->generated('.formbraid-manifest.json'));
    }

    public function test_consumes_the_shared_metadata_contract_without_loading_its_inputs(): void
    {
        config(['formbraid.requests' => []]);
        $this->write('resources/js/formbraid/_metadata.json', file_get_contents(__DIR__.'/../../core/fixtures/component-metadata.json'));
        $this->succeed();
        $enum = file_get_contents($this->root.'/app/Formbraid/FormField.php');
        self::assertStringContainsString("case input = 'input';", $enum);
        self::assertStringContainsString("case email = 'email';", $enum);
    }

    #[DataProvider('invalidMetadata')]
    public function test_missing_or_malformed_metadata_is_an_error_without_outputs(?string $metadata): void
    {
        if ($metadata === null) {
            unlink($this->root.'/resources/js/formbraid/_metadata.json');
        } else {
            $this->write('resources/js/formbraid/_metadata.json', $metadata);
        }
        $this->failWith('metadata');
        self::assertDirectoryDoesNotExist($this->root.'/resources/js/formbraid/laravel');
        self::assertFileDoesNotExist($this->root.'/app/Formbraid/FormField.php');
    }

    public static function invalidMetadata(): array
    {
        return [
            'missing' => [null], 'syntax' => ['{'], 'version' => ['{"version":2,"inputs":[],"fields":{},"components":{},"groups":{}}'],
            'registry' => ['{"version":1,"inputs":[],"fields":[],"components":{},"groups":{}}'],
            'props' => ['{"version":1,"inputs":[],"fields":{"Input":{"props":{"label":{"required":"yes","type":{"kind":"string"}}}}},"components":{},"groups":{}}'],
            'type' => ['{"version":1,"inputs":[],"fields":{"Input":{"props":{"label":{"required":true,"type":{"kind":"typo"}}}}},"components":{},"groups":{}}'],
        ];
    }

    #[DataProvider('invalidProps')]
    public function test_field_component_and_prop_validation_is_not_silently_lost(string $fields, array $props, string $error): void
    {
        $this->request(fields: $fields);
        $this->metadata($props);
        $this->failWith($error);
        self::assertFileDoesNotExist($this->root.'/app/Formbraid/FormField.php');
    }

    public static function invalidProps(): array
    {
        return [
            'missing component' => ['return ["name" => Field::make("Absent")];', [], 'unregistered field component Absent'],
            'unknown prop' => ['return ["name" => Field::make()->props(["typo" => true])];', [], 'unknown component prop typo'],
            'required prop' => ['return [];', ['tone' => ['required' => true, 'type' => ['kind' => 'string']]], 'missing required component prop tone'],
            'incompatible prop' => ['return ["name" => Field::make()->props(["tone" => 1])];', ['tone' => ['required' => false, 'type' => ['kind' => 'string']]], 'tone does not match'],
            'nested prop' => ['return ["name" => Field::make()->props(["options" => [["value" => false]]])];', ['options' => ['required' => false, 'type' => ['kind' => 'array', 'items' => ['kind' => 'object', 'properties' => ['value' => ['required' => true, 'type' => ['kind' => 'string']]]]]]], 'options does not match'],
            'tuple prop' => ['return ["name" => Field::make()->props(["options" => ["x"]])];', ['options' => ['required' => false, 'type' => ['kind' => 'array', 'tuple' => true]]], 'options does not match'],
        ];
    }

    #[DataProvider('groupShapes')]
    public function test_group_read_and_write_compatibility(array $rules, array $shape, string $target, bool $accepts, string $fields = 'return [];'): void
    {
        $this->metadata(groups: ['Container' => ['props' => (object) [], 'slots' => ['value' => $shape]]]);
        $this->request($rules, $fields, groups: 'return ["container" => FieldGroup::make(FormField::Container)->fields(["value" => '.var_export($target, true).'])];');
        if ($accepts) {
            $this->succeed();
            self::assertStringContainsString('"groups": {', $this->generated('requests/'.str_replace('\\', '/', $this->namespace).'/Http/Requests/ProfileRequest.ts'));
        } else {
            $this->failWith('incompatible field value type');
        }
    }

    public static function groupShapes(): array
    {
        $string = ['kind' => 'string'];
        $number = ['kind' => 'number'];
        $boolean = ['kind' => 'boolean'];
        $literal = static fn ($value) => ['kind' => 'literal', 'value' => $value];
        $union = static fn (...$values) => ['kind' => 'union', 'alternatives' => $values];
        $prop = static fn ($type, $required = true) => ['required' => $required, 'type' => $type];
        $record = static fn ($props) => ['kind' => 'object', 'properties' => (object) $props];
        $rows = ['value' => 'array', 'value.*.name' => 'string'];
        $object = ['value' => 'array', 'value.name' => 'string'];
        $array = ['kind' => 'array', 'items' => $record(['name' => $prop($string)])];
        $asObject = 'return ["value" => Field::make()->type("object")];';
        $numericOptions = $union($literal('1'), $literal(1), $literal('2'), $literal(2));

        return [
            'string' => [['value' => 'string'], $string, 'value', true],
            'not narrowed' => [['value' => 'string'], $literal(''), 'value', false],
            'not unknown' => [['value' => 'string'], ['kind' => 'unknown'], 'value', false],
            'nullable' => [['value' => 'nullable|string'], $union($string, ['kind' => 'null']), 'value', true],
            'nullable mismatch' => [['value' => 'nullable|string'], $string, 'value', false],
            'undefined' => [['value' => 'string'], $union($string, ['kind' => 'undefined']), 'value', false],
            'boolean union' => [['value' => 'boolean'], $union($literal(false), $literal(true)), 'value', true],
            'enum includes blank' => [['value' => 'in:home,work'], $union($literal('home'), $literal('work'), $literal('')), 'value', true],
            'enum missing blank' => [['value' => 'in:home,work'], $union($literal('home'), $literal('work')), 'value', false],
            'file' => [['value' => 'file'], $union(['kind' => 'file'], ['kind' => 'null']), 'value', true],
            'array' => [$rows, $array, 'value', true],
            'readonly array' => [$rows, [...$array, 'readonly' => true], 'value', false],
            'tuple array' => [$rows, [...$array, 'tuple' => true], 'value', false],
            'whole object' => [$object, $record(['name' => $prop($string)]), 'value', true],
            'optional property' => [$object, $record(['name' => $prop($string, false)]), 'value', false],
            'extra optional property' => [$object, $record(['name' => $prop($string), 'extra' => $prop($number, false)]), 'value', true],
            'unknown record' => [['value' => 'array'], ['kind' => 'array', 'items' => ['kind' => 'unknown']], 'value', true],
            'wildcard leaf' => [$rows, $string, 'value.*.name', false],
            'array leaf' => [['value' => 'array', 'value.0.name' => 'string'], $string, 'value.0.name', false],
            'nullable parent leaf' => [['value' => 'nullable|array', 'value.name' => 'string'], $string, 'value.name', false],
            'unsupported' => [$object, $record(['name' => $prop(['kind' => 'unsupported'])]), 'value', false],
            'boolean discriminant' => [['value' => 'array', 'value.enabled' => 'boolean', 'value.name' => 'string'], $union($record(['enabled' => $prop($literal(false)), 'name' => $prop($string)]), $record(['enabled' => $prop($literal(true)), 'name' => $prop($string)])), 'value', true],
            'missing discriminant' => [['value' => 'array', 'value.enabled' => 'boolean', 'value.name' => 'string'], $record(['enabled' => $prop($literal(false)), 'name' => $prop($string)]), 'value', false],
            'string index' => [$object, ['kind' => 'object', 'additionalProperties' => $string], 'value', false],
            'numeric index' => [$object, ['kind' => 'object', 'numericProperties' => $number], 'value', false],
            'compatible numeric index' => [['value' => 'array', 'value.01' => 'integer'], ['kind' => 'object', 'numericProperties' => $number, 'properties' => ['01' => $prop($number)]], 'value', true],
            'unknown object index' => [['value' => 'array'], ['kind' => 'object', 'additionalProperties' => ['kind' => 'unknown']], 'value', true, $asObject],
            'implicit interface index' => [['value' => 'array'], ['kind' => 'object', 'implicitIndex' => false], 'value', false, $asObject],
            'optional index conflict' => [['value' => 'array'], $record(['extra' => $prop($string, false)]), 'value', false, $asObject],
            'optional undefined property' => [$object, $record(['name' => $prop($string), 'extra' => $prop($union($string, ['kind' => 'undefined']), false)]), 'value', true],
            'array options' => [['value' => 'array|in:red,blue'], ['kind' => 'array', 'items' => $union($literal('red'), $literal('blue'))], 'value', true],
            'numeric option coercion' => [['value' => 'array|in:1,2'], ['kind' => 'array', 'items' => $numericOptions], 'value', true],
            'numeric option narrowing' => [['value' => 'array|in:1,2'], ['kind' => 'array', 'items' => $union($literal(1), $literal(2))], 'value', false],
            'object options' => [['value' => 'array|in:red,blue'], ['kind' => 'object', 'additionalProperties' => $union($literal('red'), $literal('blue'))], 'value', true, $asObject],
        ];
    }

    public function test_recursive_prop_types_accept_valid_json_without_widening_nested_literals_or_indices(): void
    {
        $this->metadata(['options' => ['required' => true, 'type' => ['kind' => 'array', 'items' => [
            'kind' => 'object', 'properties' => ['value' => ['required' => true, 'type' => ['kind' => 'union', 'alternatives' => [['kind' => 'literal', 'value' => 'red'], ['kind' => 'literal', 'value' => 'blue']]]]],
        ]]]]);
        $this->request(fields: 'return ["name" => Field::make()->props(["options" => [["value" => "red"], ["value" => "blue"]]])];');
        $this->succeed();
        $this->metadata(['options' => ['required' => true, 'type' => ['kind' => 'array', 'items' => ['kind' => 'object', 'additionalProperties' => ['kind' => 'number']]]]]);
        $this->failWith('options does not match');
    }

    #[DataProvider('discriminantCounts')]
    public function test_finite_discriminant_combinations_are_bounded_without_widening(int $count, bool $accepts): void
    {
        $rules = ['value' => 'array'];
        for ($index = 0; $index < $count; $index++) {
            $rules['value.b'.$index] = 'boolean';
        }
        $alternatives = [];
        for ($bits = 0; $bits < 2 ** $count; $bits++) {
            $props = [];
            for ($index = 0; $index < $count; $index++) {
                $props['b'.$index] = ['required' => true, 'type' => ['kind' => 'literal', 'value' => ($bits & (1 << $index)) !== 0]];
            }
            $alternatives[] = ['kind' => 'object', 'properties' => (object) $props];
        }
        $this->test_group_read_and_write_compatibility($rules, ['kind' => 'union', 'alternatives' => $alternatives], 'value', $accepts);
    }

    public static function discriminantCounts(): array
    {
        return [[4, true], [5, false]];
    }

    public function test_finite_deep_arrays_remain_structural(): void
    {
        $rules = [];
        $shape = ['kind' => 'unknown'];
        for ($index = 0; $index < 16; $index++) {
            $rules['value'.str_repeat('.*', $index)] = 'array';
            $shape = ['kind' => 'array', 'items' => $shape];
        }
        $this->test_group_read_and_write_compatibility($rules, $shape, 'value', true);
    }

    public function test_group_slots_and_props_are_validated(): void
    {
        $this->request(groups: 'return ["container" => FieldGroup::make("Container")->fields(["value" => "name"])];');
        $this->metadata();
        $this->failWith('unregistered group Container');
        $this->metadata(groups: ['Container' => ['props' => (object) []]]);
        $this->failWith('slots could not be inspected');
        $this->metadata(groups: ['Container' => ['props' => (object) [], 'slots' => ['other' => ['kind' => 'string']]]]);
        $this->failWith('missing group slot other');
        $this->metadata(groups: ['Container' => ['props' => (object) [], 'slots' => (object) []]]);
        $this->failWith('invalid group slot or field value');
        $this->metadata(groups: ['Container' => ['props' => ['title' => ['required' => true, 'type' => ['kind' => 'string']]], 'slots' => ['value' => ['kind' => 'string']]]]);
        $this->failWith('missing required component prop title');
    }

    public function test_only_unchanged_generator_owned_obsolete_files_are_deleted_and_scaffolds_survive(): void
    {
        $request = $this->request();
        $this->write('resources/js/formbraid/fields/Input.tsx', 'user scaffold');
        $this->write('resources/js/formbraid/laravel/custom.ts', 'user module');
        $this->succeed();
        $manifest = $this->generated('.formbraid-manifest.json');
        $owned = $this->generated('requests/'.str_replace('\\', '/', $request).'.ts');
        $this->write('resources/js/formbraid/laravel/requests/'.str_replace('\\', '/', $request).'.ts', 'user edited generated file');
        $this->failWith('modified file');
        self::assertSame($manifest, $this->generated('.formbraid-manifest.json'));
        config(['formbraid.requests' => []]);
        $this->failWith('modified file');
        $this->write('resources/js/formbraid/laravel/requests/'.str_replace('\\', '/', $request).'.ts', $owned);
        $this->succeed();
        self::assertFileDoesNotExist($this->root.'/resources/js/formbraid/laravel/requests/'.str_replace('\\', '/', $request).'.ts');
        self::assertSame('user module', $this->generated('custom.ts'));
        self::assertSame('user scaffold', file_get_contents($this->root.'/resources/js/formbraid/fields/Input.tsx'));
    }

    public function test_generation_can_expand_an_enum_already_loaded_by_configuration(): void
    {
        $this->request(fields: 'return ["name" => Field::make(FormField::Input)];');
        $this->succeed();
        $path = $this->root.'/resources/js/formbraid/_metadata.json';
        $metadata = json_decode(file_get_contents($path), flags: JSON_THROW_ON_ERROR);
        $metadata->fields->NewInput = $metadata->fields->Input;
        file_put_contents($path, json_encode($metadata, JSON_THROW_ON_ERROR));
        $this->succeed();
        self::assertStringContainsString("case NewInput = 'NewInput';", file_get_contents($this->root.'/app/Formbraid/FormField.php'));
    }

    public function test_a_late_validation_failure_does_not_publish_any_partial_outputs(): void
    {
        $first = $this->request(relative: 'ARequest');
        $this->succeed();
        $before = $this->generated('requests/'.str_replace('\\', '/', $first).'.ts');
        $manifest = $this->generated('.formbraid-manifest.json');
        $this->request(fields: 'return ["name" => Field::make("Missing")];', relative: 'ZRequest');
        $this->failWith('unregistered field component Missing');
        self::assertSame($before, $this->generated('requests/'.str_replace('\\', '/', $first).'.ts'));
        self::assertSame($manifest, $this->generated('.formbraid-manifest.json'));
        self::assertFileDoesNotExist($this->root.'/resources/js/formbraid/laravel/requests/'.$this->namespace.'/Http/Requests/ZRequest.ts');
    }

    public function test_refuses_non_owned_outputs_and_invalid_driver_configuration(): void
    {
        $request = $this->request();
        $path = 'resources/js/formbraid/laravel/requests/'.str_replace('\\', '/', $request).'.ts';
        $this->write($path, 'user file');
        $this->failWith('non-owned');
        self::assertSame('user file', file_get_contents($this->root.'/'.$path));
        self::assertFileDoesNotExist($this->root.'/app/Formbraid/FormField.php');
        config(['formbraid.submission_driver' => \stdClass::class]);
        $this->failWith('implementing');
    }

    public function test_refuses_non_owned_enum_and_symlink_outputs_and_path_traversal(): void
    {
        $this->request();
        $this->write('app/Formbraid/FormField.php', '<?php // user enum');
        $this->failWith('non-owned');
        self::assertSame('<?php // user enum', file_get_contents($this->root.'/app/Formbraid/FormField.php'));
        unlink($this->root.'/app/Formbraid/FormField.php');
        mkdir($this->root.'/outside');
        symlink($this->root.'/outside', $this->root.'/resources/js/formbraid/laravel');
        $this->failWith('symlink');
        self::assertSame(['.', '..'], scandir($this->root.'/outside', SCANDIR_SORT_ASCENDING));
        config(['formbraid.output' => '../escape']);
        $this->failWith('without traversal');
    }

    public function test_enum_psr4_mapping_uses_the_longest_directory_and_escapes_unusual_keys(): void
    {
        config(['formbraid.requests' => []]);
        $this->write('composer.json', json_encode(['autoload' => ['psr-4' => [$this->namespace.'\\' => 'app/', $this->namespace.'\\Special\\' => ['./app/Formbraid/']]]], JSON_THROW_ON_ERROR));
        $key = "quoted'\\key";
        $this->write('resources/js/formbraid/_metadata.json', json_encode(['version' => 1, 'inputs' => [], 'fields' => (object) [$key => ['props' => (object) []]], 'components' => (object) [], 'groups' => (object) []], JSON_THROW_ON_ERROR));
        $this->succeed();
        $this->succeed();
        $enum = $this->namespace.'\\Special\\FormField';
        self::assertTrue(enum_exists($enum));
        self::assertSame($key, $enum::cases()[0]->value);
    }
}
