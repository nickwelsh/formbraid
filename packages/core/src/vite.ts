/** Node-only build entrypoint. Never imported by the runtime entrypoint. */
export type {
    ComponentInfo,
    ComponentMetadata,
    Integration,
    ModuleExport,
    PropShape,
    RegistryManifest,
    TypeShape,
} from './tooling/contracts.js';
export { inspectRegistries } from './tooling/inspect.js';
