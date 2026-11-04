# Formbraid

Framework-agnostic form contracts, application-owned components, and Effect-powered state and execution. Any integration can produce a typed definition and a callback-backed descriptor; the runtime does not depend on the backend or producer. React is the current UI binding. Laravel is an optional Composer integration, not a runtime requirement.

Formbraid owns the editable draft, validation, subscriptions, and submission lifetime. Your application owns HTML, accessibility, styling, and widgets. Producers supply definitions and submission callbacks rather than a second editable-value store.

## Packages

| Package                | Responsibility                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `@formbraid/core`      | Portable definitions and descriptors, constraint validation, Effect form sessions         |
| `@formbraid/core/vite` | Build-only integration contracts, static component inspection, Vite plugin                |
| `@formbraid/react`     | React contexts, subscriptions, typed fields, form components, groups, and layouts         |
| `@formbraid/generator` | Optional producer-author tooling SDK re-exporting `@formbraid/core/vite`                  |
| `formbraid/laravel`    | Composer integration: scaffolding, FormRequest extraction, enum and TypeScript generation |

Applications need `@formbraid/core`, `@formbraid/react`, `effect`, and `react`; they do not need the generator SDK. There is no Formbraid Inertia package or Laravel Node package. npm publication covers three packages: core, React, and generator. Composer publication remains `formbraid/laravel`. Packages have not yet been published; use workspace dependencies or local archives and a Composer path repository. See [RELEASING.md](RELEASING.md).

The [documentation](https://docs.nickwelsh.me/formbraid/) includes usage guides and a generated API reference. The runtime uses Effect **4.0.2**. See also the [performance benchmark](benchmarks/README.md).

## Public form contract

Generation is optional. A producer can return a version-1 descriptor using only core's public types:

```ts
import type { FormDefinition, FormDescriptor, SubmissionCallback } from '@formbraid/core';

type TodoValues = { title: string; done: boolean };
declare const definition: FormDefinition<TodoValues>;

const submit: SubmissionCallback<TodoValues> = async (values, { signal }) => {
    const response = await fetch('/api/todos/42', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
        signal,
    });
    // This endpoint's successful response must mean authoritative acceptance.
    // Supply application authentication/CSRF and map validation errors as needed.
    if (!response.ok) return { status: 'failure', error: new Error(`Save failed: ${response.status}`) };
    return { status: 'success' };
};

const todoForm = {
    version: 1,
    definition,
    defaultValues: { title: 'Buy milk', done: false },
    submission: { submit },
} satisfies FormDescriptor<TodoValues>;
```

Callbacks receive decoded values and `{ signal, onProgress }` and return an explicit `SubmissionResult` or `PromiseLike<SubmissionResult>`. Results are `success`, `invalid` (field/root errors), `failure` (expected errors), `cancelled`, or `defect`. Use `SubmissionCallback<Output, Success, Error>` for typed payloads. Thrown exceptions and rejected promises become defects; return expected failures explicitly. Do not report success for an optimistic write that the server may still reject.

There is no runtime submission-driver registry, named JSON binding, `bindForm`, or executable JSON descriptor parser. Validate external metadata at its boundary, then attach a trusted callback in code. `defineForm<Values>()` preserves literal field and component names. Native Effect schemas can extend definitions for decoding and transformations.

```tsx
// Form and useForm come from your component configuration below.
<Form form={todoForm} />;

const instance = useForm(todoForm);
return <Form form={instance} />;
```

Definition defaults are the fallback; descriptor defaults override them, and explicit `defaultValues` override descriptor defaults. Defaults initialize a mount, not every rerender. Use a key or reset to switch records. Committed callback changes affect future submissions; an in-flight submission retains its captured handler and values. A local `submit` callback or Effect `operation` can override descriptor execution.

## Register React components

```tsx
import { useFieldContext, type FieldProps } from '@formbraid/react';
import { useId } from 'react';

export function TextField({ label, helpText, constraints }: FieldProps<string>) {
    const field = useFieldContext<string>();
    const id = useId();
    return (
        <div>
            <label htmlFor={id}>{label}</label>
            <input
                id={id}
                name={field.name}
                value={field.value}
                onChange={(event) => field.setValue(event.target.value)}
                onBlur={field.touch}
                required={constraints.required}
                minLength={constraints.minLength}
                maxLength={constraints.maxLength}
                aria-invalid={field.errors.length > 0}
            />
            {helpText && <p>{helpText}</p>}
            <span role="alert">{field.errors.join(' ')}</span>
        </div>
    );
}
```

Register literal component keys, with no submission or build integrations in the React configuration:

```ts
// resources/js/formbraid/index.ts
import { defineConfig } from '@formbraid/react';
import { TextField, CheckboxField } from './fields';
import { SubmitButton, FormErrors } from './form-components';
import { AddressAutocomplete } from './address-group';

export const { Form, useForm } = defineConfig({
    components: { TextField, CheckboxField },
    formComponents: { SubmitButton, FormErrors },
    groups: { AddressAutocomplete },
    submitComponent: 'SubmitButton',
});
```

`setValue` accepts a value or updater; `touch()` records interaction. Contexts expose normalized errors and `isTouched`, `isDirty`, and `isValid` metadata. Without children, `Form` renders ungrouped fields and each group once in field order, followed by the submit component. Custom layouts receive typed `fields`, `components`, and `groups`. Component identity remains stable across edits and metadata updates.

See the guides for [components](apps/docs/content/docs/0.x/react/components.mdx), [layouts](apps/docs/content/docs/0.x/react/forms.mdx), [composite groups](apps/docs/content/docs/0.x/react/groups.mdx), and [nested values and arrays](apps/docs/content/docs/0.x/react/arrays.mdx). Dynamic arrays support `append`, `remove`, and `move`; tuples require slot edits or whole-value replacement. Reads through missing/nullable containers and dynamic indexes can include `undefined` while writes retain the declared leaf type.

## Laravel: scaffold, then start Vite

Install the Composer package in your Laravel app (using a path repository until publication), then run:

```sh
composer require formbraid/laravel:@dev
php artisan formbraid:init --register-vite
```

`formbraid:init` creates user-owned `index.ts`, `fields.tsx`, `form-components.tsx`, and build-safe `laravel.ts` in the directory containing the configured metadata file. It preserves existing files on reruns and never invents metadata JSON. `--register-vite` only edits a conventional literal `defineConfig({ plugins: [...] })` config; otherwise it prints imports and registration instructions:

```ts
// vite.config.ts — alongside your existing Vite plugins
import { defineConfig } from 'vite';
import { vitePlugin as formbraid } from '@formbraid/core/vite';
import laravelForms from './resources/js/formbraid/laravel';

export default defineConfig({
    plugins: [formbraid({ integrations: [laravelForms] })],
});
```

The generated build-only descriptor uses `registry: new URL('./index.ts', import.meta.url)`, `metadata: new URL('./_metadata.json', import.meta.url)`, and `command: ['php', 'artisan', 'formbraid:generate']`. Its PHP watch patterns include requests, app code, routes, and config; `outputs` excludes generated TypeScript and the enum from input watching.

Vite is the sole metadata producer. It statically inspects TypeScript without evaluating browser modules, CSS imports, or `window`; atomically writes `_metadata.json`; then runs Artisan. Dev watching tracks component imports, PHP patterns, and newly created app module directories, coalescing changes and avoiding output loops. Artisan consumes JSON only. If standalone `php artisan formbraid:generate` reports missing metadata, start Vite once; Artisan cannot refresh it.

PHP configuration (showing an additional modular request pattern and a minimal set of mappings):

```php
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

`component_enum` is an output file path, not a class name. One merged string-backed enum covers field components, form components, and groups; its namespace follows Composer PSR-4 mappings. Keep initial mappings as strings so the first metadata pass can bootstrap. Afterwards, use generated `App\Formbraid\FormField` cases in `fields()` and `groups()` or config mappings. Clear cached Laravel config after changing it.

PHP generates namespace-preserving `requests/<FQCN>.ts` definitions using `defineForm`, and `controllers/<ControllerFQCN>.ts` exports:

```tsx
import { Form } from './formbraid';
import { update } from './formbraid/laravel/controllers/App/Http/Controllers/ProfileController';

<Form form={update({ user: 42 })} defaultValues={values} />;
```

`update(...)` returns a descriptor directly; there is no `.form()` helper. Generated outputs are hash-owned: generation refuses edited or unowned files rather than overwriting them. Scaffolds remain user-owned. See [Laravel generation](apps/docs/content/docs/0.x/laravel/generation.mdx).

The PHP `SubmissionDriver::generate(string $endpoint, string $method): string` accepts a safe TypeScript endpoint expression and emits a callback expression. Built-in Fetch emits self-contained code with same-origin credentials, live URL-decoded `XSRF-TOKEN` cookie forwarding as `X-XSRF-TOKEN`, multipart/method spoofing, validation-error mapping, and cancellation. Select `Formbraid\Laravel\Drivers\Inertia::class` for an existing Inertia React app; generated code dynamically imports its `@inertiajs/react` router. No Formbraid Inertia package, runtime registry, or manual CSRF token plumbing is needed.

## Validation, Effect operations, and headless use

Validation runs on submit, not edit or blur. Native Effect schemas decode the captured draft before submission. Client constraints provide feedback, while the backend remains authoritative for validation and authorization. Generated schemas are cached per definition; treat definitions as readonly. See [validation](apps/docs/content/docs/0.x/validation.mdx) for conditional rules, wildcard arrays, defaults, and server-only checks.

Callbacks and typed Effect `operation`/`run` options coexist. Operations retain success, domain-error, and service types; native schemas can transform draft values into different output types. The runner must provide the services required by decoding and execution. See the complete [headless session example](apps/docs/content/docs/0.x/advanced/headless.mdx).

`submitEffect()` is a lazy wait; `submit()` starts the same work immediately. Concurrent callers share one submission. The session owns its fiber and scope; interrupting one waiter does not cancel shared execution. `cancel()`, `reset()`, and `dispose()` interrupt execution for all callers, with scoped finalizers releasing resources. Cancellation aborts callbacks and suppresses late results/progress but cannot undo accepted server mutations. Success commits only the submitted baseline; later edits remain dirty, and stale server errors cannot overwrite them.

## Develop this repository

Requires Node 24.11+, pinned pnpm, Vite+, Composer, and PHP 8.4.1+ for locked development dependencies (the Composer package supports PHP 8.3+).

```sh
vp install
composer install --working-dir=packages/laravel
vp run build
vp run dev
```

Vite starts generation for the example. No generator CLI or separate frontend-framework pipeline is required.

To exercise the example's generated Fetch callback, run its PHP backend in a second terminal:

```sh
php -S 127.0.0.1:8000 -t examples/react/public examples/react/public/index.php
```

The Vite example proxies its submission and CSRF-cookie routes to that backend. The address lookup uses a fixed sample suggestion; connect your preferred provider in application code.

```sh
vp check
vp exec tsc --noEmit
vp test run
composer --working-dir=packages/laravel test
composer --working-dir=packages/laravel check
pnpm docs:check
```

`.agents/setup` prepares the orb toolchain, dependencies, and library builds; `.agents/resume` checks readiness without reinstalling. Setup does not build docs, start servers, or authenticate deployment services. See [development](apps/docs/content/docs/0.x/development.mdx) for documentation commands.
