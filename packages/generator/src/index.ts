/** Optional build-time SDK for producer packages. Applications configure @formbraid/core/vite directly. */
export {
    inspectComponents,
    inspectComponentsEffect,
    inspectRegistries,
    RegistryInspectionError,
    vitePlugin,
} from '@formbraid/core/vite';
export type {
    ComponentInfo,
    ComponentMetadata,
    Integration,
    ModuleExport,
    PropShape,
    RegistryManifest,
    TypeShape,
} from '@formbraid/core/vite';
