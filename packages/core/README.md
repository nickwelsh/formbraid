# @formbraid/core

Framework-agnostic form definitions, callback-backed descriptors, validation, and scoped Effect form sessions. React is the current UI binding, but core does not require React, Laravel, or generation.

```sh
pnpm add @formbraid/core effect
```

`FormDescriptor` is `{ version: 1, definition, defaultValues?, submission: { submit } }`. The callback receives decoded values and `{ signal, onProgress }`, and returns an explicit `SubmissionResult` or `PromiseLike<SubmissionResult>`. Typed Effect `operation` and `run` options remain available for service-dependent and headless workflows. There is no runtime submission-driver registry or executable JSON descriptor parser.

The Node-only `@formbraid/core/vite` subpath exports `vitePlugin({ integrations })`, static `inspectComponents`, and build-only `Integration` / component metadata contracts. Keep these imports in Vite or producer tooling, never browser runtime code. Vite atomically produces component metadata before invoking an integration's backend command; it never evaluates the application's UI modules.

`inspectComponentsEffect(module, root)` provides the same inspection as `Effect<ComponentMetadata, RegistryInspectionError>`. Recover with `Effect.catchTag('RegistryInspectionError', ...)`; the error retains `module`, `root`, and the original `cause`, and its message includes that context. Vite uses this boundary so thrown inspection errors become typed failures rather than defects. The synchronous `inspectComponents` and `inspectRegistries` APIs retain their existing return values and thrown errors.

Generation runs in a managed Effect runtime with scoped temporary files and child processes. Watch changes are debounced and serialized; changes arriving during a command queue another run without interrupting it. Closing Vite interrupts pending work and waits for process cleanup, escalating to a forced kill after two seconds when needed. Backend commands can still be executable/argument tuples or shell strings.

## Portable option metadata

`FieldDefinition.options?: FieldOptions` describes presentation, independently of finite validation `constraints.options`:

```ts
type Option = { readonly value: string | number; readonly label: string; readonly disabled?: boolean };
type OptionInputReference =
    | { readonly kind: 'value' }
    | { readonly kind: 'field'; readonly path: string }
    | { readonly kind: 'context'; readonly key: string };
type FieldOptions =
    | { readonly kind: 'static'; readonly items: readonly Option[] }
    | {
          readonly kind: 'source';
          readonly id: string;
          readonly inputs: readonly OptionInputReference[];
          readonly resolveInputs: readonly OptionInputReference[];
      };
```

`PresentationOptionSchema`, `OptionInputReferenceSchema`, and `FieldOptionsSchema` are exported alongside `FieldDefinitionSchema`; the version-1 extraction decoder round-trips these JSON-only declarations. Core contains no executable source registry, React adapter, query builder, or transport. `value` references mean control-local input; listing and selected-ID resolution dependencies/readiness are independent. See `@formbraid/react` for per-descriptor binding and live hook lifecycle, and `formbraid/laravel` for build-time declaration extraction.

See the [Formbraid documentation](https://docs.nickwelsh.me/formbraid/) and [source repository](https://github.com/nickwelsh/formbraid).
