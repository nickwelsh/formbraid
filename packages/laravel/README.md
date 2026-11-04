# formbraid/laravel

The Composer integration for Formbraid. Generate typed forms from Laravel FormRequests and controller routes, using your application's React components. There is no Laravel Node package.

```sh
composer require formbraid/laravel
php artisan formbraid:init --register-vite
```

Packages have not yet been published. For local development, configure a Composer path repository pointing to this directory and require `formbraid/laravel:@dev`. The frontend needs `@formbraid/core`, `@formbraid/react`, `effect`, and `react`; no generator SDK or Formbraid Inertia adapter is required.

## Scaffold once; keep editing your files

`php artisan formbraid:init [--register-vite]` creates `index.ts`, `fields.tsx`, `form-components.tsx`, and build-safe `laravel.ts` beside the configured metadata file (by default `resources/js/formbraid/_metadata.json`). `index.ts` uses React's component-only `defineConfig({ components, formComponents, groups?, submitComponent })`. The scaffold is user-owned: rerunning init preserves existing files and edits. Init does not generate placeholder JSON.

The optional Vite registration only modifies a standard literal `defineConfig({ plugins: [...] })`. For complex configs, init prints manual imports and registration:

```ts
import { vitePlugin as formbraid } from '@formbraid/core/vite';
import laravelForms from './resources/js/formbraid/laravel';

// Add alongside your existing Vite plugins:
formbraid({ integrations: [laravelForms] });
```

The default descriptor points to `./index.ts` and `./_metadata.json`, runs `['php', 'artisan', 'formbraid:generate']`, watches PHP inputs, and excludes generated TypeScript and the enum through `outputs`. It imports no React runtime modules.

## Vite produces metadata; PHP consumes it

Start Vite once. It statically inspects component types without evaluating CSS imports or browser globals, atomically writes metadata, and then runs Artisan. Dev watching follows component imports and PHP patterns, including newly created app module directories; changes coalesce and generated outputs do not retrigger generation.

Standalone `php artisan formbraid:generate` consumes existing JSON only. Missing metadata is an error: start Vite once, do not fabricate the file or expect Artisan to inspect TypeScript.

```php
// config/formbraid.php
return [
    'requests' => ['app/Http/Requests', 'app/Modules/**/Requests/**/*.php'],
    'metadata' => 'resources/js/formbraid/_metadata.json',
    'output' => 'resources/js/formbraid/laravel',
    'component_enum' => 'app/Formbraid/FormField.php',
    'submission_driver' => Formbraid\Laravel\Drivers\Fetch::class,
    'fields' => [
        'types' => ['string' => 'TextField', 'boolean' => 'CheckboxField'],
        'rules' => [],
        'fallbackType' => 'string',
    ],
];
```

`requests` accepts directories or PHP glob patterns. `component_enum` is an output path, not a class name. One merged string-backed enum includes fields, form components, and groups, with namespace inferred from Composer PSR-4. Bootstrap with string component mappings; after the first metadata pass use generated cases such as `App\Formbraid\FormField::TextField` in `fields()` and `FormField::AddressAutocomplete` in `groups()`. Clear cached Laravel config after changing it.

## Generated forms

PHP emits namespace-preserving `requests/App/Http/Requests/UpdateProfileRequest.ts` definitions using `defineForm` and `controllers/App/Http/Controllers/ProfileController.ts` exports:

```tsx
import { Form } from './formbraid';
import { update } from './formbraid/laravel/controllers/App/Http/Controllers/ProfileController';

<Form form={update({ user: 42 })} />;
```

Controller functions return `{ version: 1, definition, submission: { submit } }` descriptors directly, not `.form()` helpers. Generated files are hash-owned: edited or unowned output files are refused, not overwritten. Customize scaffold files instead.

## Submission code generation

`Formbraid\Laravel\Contracts\SubmissionDriver::generate(string $endpoint, string $method): string` receives a safe TypeScript endpoint expression and returns a callback expression. This is a PHP generation contract, not a JavaScript runtime registry.

- `Formbraid\Laravel\Drivers\Fetch` emits self-contained Fetch code with same-origin credentials, the live URL-decoded `XSRF-TOKEN` cookie forwarded as `X-XSRF-TOKEN`, multipart/method spoofing, validation error mapping, and abort support.
- `Formbraid\Laravel\Drivers\Inertia` dynamically imports the existing application's `@inertiajs/react` router. No Formbraid Inertia package or manual CSRF token plumbing is needed.

Callbacks receive validated values and `{ signal, onProgress }`, and return explicit submission results. Local callback overrides and scoped Effect operations remain available. The backend remains authoritative for validation and authorization. `formbraid:export` and `formbraid:http` remain lower-level schema and HTTP inspection commands, not a Node installation workflow.

## Presentation options and provider producers

Declare explicit static value/label pairs independently of finite `in:` validation:

```php
'status' => Field::make('SelectField')->options([
    ['value' => 'open', 'label' => 'Open'],
    ['value' => 'closed', 'label' => 'Closed', 'disabled' => true],
]),
```

Dynamic providers implement `Formbraid\Laravel\Contracts\OptionSource` with `inputs(): array` and `resolveInputs(): array`, each returning discovered `list<OptionInput>` dependencies for its operation. Application authors embed references in the provider's declaration; they do not maintain a second input mapping. `Field::options(array|OptionSource $options): self` accepts either declaration. Formbraid does not know or depend on a provider query builder, AST, network protocol, or authorization strategy.

`Formbraid\Laravel\OptionInput` is final/readonly and provides symbolic `value()`, `field(string $path)`, and `context(string $key)` constructors. Inspect `kind`, `path`, `key`, or `toArray()`; there is no string coercion. `value()` is control-local input, **not** the selected draft ID. Selected-ID queries should explicitly declare their own field/context dependencies, never depend on local input or derive eligibility by removing search predicates.

`RequestExtractor::extract(object $request): array` preserves `form` and `diagnostics` and, for source-backed forms, adds `optionSources: array<string, OptionSource>`. The latter retains each original build-time declaration. The portable `form` contains only JSON; input references are deduplicated per operation. IDs are deterministic `RequestClass:field.path` wiring identifiers, not credentials or query fingerprints. Providers own query fingerprinting. Known concrete field paths are checked against validation-rule paths (including concrete numeric paths through wildcard rules); wildcard-relative/repeater sources are explicitly rejected. Context references remain available to a producer for validation against the specific action's bound context.

`FormEmitter::emit(array $form, array $supportedOptionSources = []): string` emits portable definitions. A specialized producer first recognizes and compiles each source declaration, then passes the list of source IDs it handled. Any unhandled ID fails with a request/field diagnostic. The ordinary Laravel `formbraid:generate`/`formbraid:export` commands cannot compile external providers and fail helpfully rather than drop their sources. A provider producer can reuse extraction/emission and generate React's `withOptionSources(descriptor, bindings, context)` attachment alongside its ordinary submission descriptor. Never serialize query objects, closures, bindings, or context-dependent executable code into field props.

Static/dynamic presentation options never change inferred value types, `constraints.options`, submission payloads, or authoritative validation. Component prop inspection stays strict; controls consume source state through React's `useFieldOptions`, not a required executable prop. Provider-specific input contracts, selected-ID resolution, registered reads, authorization, caching, pagination, and retries belong in the integration. No Zero/HTTP adapter ships with Formbraid.

See the [documentation](https://docs.nickwelsh.me/formbraid/) and [source repository](https://github.com/nickwelsh/formbraid). The [Composer mirror](https://github.com/formbraid/laravel) is maintained automatically; submit changes and issues to the source repository.
