import type { JsonValue } from '@formbraid/core';

/** JSON-only types shared by component inspectors and backend generators. */
export interface TypeShape {
    readonly kind:
        | 'string'
        | 'number'
        | 'boolean'
        | 'null'
        | 'undefined'
        | 'file'
        | 'object'
        | 'array'
        | 'union'
        | 'literal'
        | 'unknown'
        | 'unsupported'
        | 'function';
    readonly value?: JsonValue;
    readonly properties?: Readonly<Record<string, PropShape>>;
    readonly additionalProperties?: TypeShape;
    readonly numericProperties?: TypeShape;
    readonly implicitIndex?: boolean;
    readonly items?: TypeShape;
    readonly tuple?: boolean;
    readonly readonly?: boolean;
    readonly alternatives?: ReadonlyArray<TypeShape>;
}

export interface PropShape {
    readonly required: boolean;
    readonly type: TypeShape;
}

export interface ComponentInfo {
    readonly props: Readonly<Record<string, PropShape>>;
    readonly slots?: Readonly<Record<string, TypeShape>>;
}

export interface RegistryManifest {
    readonly fields: Readonly<Record<string, ComponentInfo>>;
    readonly components: Readonly<Record<string, ComponentInfo>>;
    readonly groups: Readonly<Record<string, ComponentInfo>>;
}

export interface ComponentMetadata extends RegistryManifest {
    readonly version: 1;
    /** Inspection inputs, used by the producer to watch transitive dependencies. */
    readonly inputs: ReadonlyArray<string>;
}

/** Build-only wiring; backend commands consume metadata, never frontend modules. */
export interface Integration {
    readonly name: string;
    readonly registry: URL;
    readonly metadata: URL;
    readonly command: string | readonly [string, ...Array<string>];
    readonly watch: ReadonlyArray<string>;
    readonly outputs: ReadonlyArray<string>;
}

export interface ModuleExport {
    readonly module: string;
    readonly export: string;
}
