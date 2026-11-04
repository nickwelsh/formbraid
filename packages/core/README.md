# @formbraid/core

Framework-agnostic form definitions, callback-backed descriptors, validation, and scoped Effect form sessions. React is the current UI binding, but core does not require React, Laravel, or generation.

```sh
pnpm add @formbraid/core effect
```

`FormDescriptor` is `{ version: 1, definition, defaultValues?, submission: { submit } }`. The callback receives decoded values and `{ signal, onProgress }`, and returns an explicit `SubmissionResult` or `PromiseLike<SubmissionResult>`. Typed Effect `operation` and `run` options remain available for service-dependent and headless workflows. There is no runtime submission-driver registry or executable JSON descriptor parser.

The Node-only `@formbraid/core/vite` subpath exports `vitePlugin({ integrations })`, static `inspectComponents`, and build-only `Integration` / component metadata contracts. Keep these imports in Vite or producer tooling, never browser runtime code. Vite atomically produces component metadata before invoking an integration's backend command; it never evaluates the application's UI modules.

See the [Formbraid documentation](https://docs.nickwelsh.me/formbraid/) and [source repository](https://github.com/nickwelsh/formbraid).
