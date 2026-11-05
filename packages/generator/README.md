# @formbraid/generator

Optional tooling SDK for integration and producer authors. This package re-exports the build-only contracts, static component inspection, and Vite plugin from `@formbraid/core/vite`.

```sh
pnpm add -D @formbraid/generator
```

Applications do not need this package. Use `@formbraid/core` and `@formbraid/react` for runtime forms, and `@formbraid/core/vite` in Vite configuration. There is no generator CLI, React framework generator pipeline, or runtime submission registry.

Producer tooling can use `Integration`, `ComponentMetadata`, `RegistryManifest`, `inspectComponents(module, root)`, and `vitePlugin({ integrations })`. Integration descriptors connect a registry URL, metadata URL, backend command, input watch patterns, and output exclusions. Vite is the sole metadata producer; backend commands consume the finished JSON snapshot and emit callback-backed descriptors.

`inspectComponentsEffect(module, root)` and `RegistryInspectionError` are also re-exported for Effect workflows. Inspection errors enter the typed failure channel with the original `cause` and the supplied `module` / `root`; recover by tag with `Effect.catchTag('RegistryInspectionError', ...)`. Synchronous inspection APIs remain unchanged.

See the [Formbraid documentation](https://docs.nickwelsh.me/formbraid/) and [source repository](https://github.com/nickwelsh/formbraid).
