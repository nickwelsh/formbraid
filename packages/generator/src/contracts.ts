/* oxlint-disable eslint/new-cap -- Effect tagged errors use a class factory. */
import type { Extraction, JsonValue, Operation } from '@formbraid/core';
import type { RegistryManifest } from '@formbraid/core/vite';
export type { ModuleExport, TypeShape, PropShape, ComponentInfo, RegistryManifest } from '@formbraid/core/vite';
import { Data, Effect } from 'effect';

export class GenerationError extends Data.TaggedError('GenerationError')<{
    readonly stage: 'configuration' | 'inspection' | 'emission' | 'formatting' | 'drift' | 'artifacts';
    readonly message: string;
    readonly cause?: unknown;
}> {}

export function generationStep<A>(
    stage: GenerationError['stage'],
    evaluate: () => A,
): Effect.Effect<A, GenerationError> {
    return Effect.try({
        try: evaluate,
        catch: (cause) =>
            new GenerationError({ stage, message: cause instanceof Error ? cause.message : String(cause), cause }),
    });
}

export interface GenerationContext {
    readonly root: string;
    readonly output: OutputConfig;
    readonly source?: string;
    readonly submission?: string;
}

export interface GeneratedFile {
    readonly path: string;
    readonly contents: string;
}

export interface SourceDriver<E = never, R = never> {
    readonly extract: (context: GenerationContext) => Effect.Effect<Extraction, E, R>;
    readonly artifacts?: (
        manifest: RegistryManifest,
        context: GenerationContext,
    ) => Effect.Effect<ReadonlyArray<GeneratedFile>, E, R>;
}

export interface FrameworkDriver {
    readonly inspect: (context: GenerationContext) => RegistryManifest;
    readonly generate: (
        extraction: Extraction,
        manifest: RegistryManifest,
        context: GenerationContext,
    ) => ReadonlyArray<GeneratedFile>;
    readonly actions: (
        operations: ReadonlyArray<GeneratedOperation>,
        extraction: Extraction,
        context: GenerationContext,
    ) => ReadonlyArray<GeneratedFile>;
}

export interface OperationProvider<TBinding = JsonValue, E = never, R = never> {
    readonly source: SourceDriver<unknown, unknown>;
    readonly extract: (context: GenerationContext) => Effect.Effect<ReadonlyArray<Operation<TBinding>>, E, R>;
}

export interface GeneratedOperation extends Operation<string> {
    readonly imports: ReadonlyArray<string>;
}

export interface SubmissionGenerator<E = never, R = never> {
    readonly source: SourceDriver<unknown, unknown>;
    readonly operations: (context: GenerationContext) => Effect.Effect<ReadonlyArray<GeneratedOperation>, E, R>;
}

export function defineSubmission<TBinding, E, R>(options: {
    readonly bindings: OperationProvider<TBinding, E, R>;
    readonly imports?: ReadonlyArray<string>;
    readonly emitBinding: (operation: Operation<TBinding>) => string;
}): SubmissionGenerator<E | GenerationError, R> {
    return {
        source: options.bindings.source,
        operations: (context) =>
            Effect.suspend(() =>
                Effect.flatMap(options.bindings.extract(context), (operations) =>
                    generationStep('emission', () =>
                        operations.map((operation) => ({
                            name: operation.name,
                            schema: operation.schema,
                            parameters: operation.parameters,
                            binding: options.emitBinding(operation),
                            imports: options.imports ?? [],
                        })),
                    ),
                ),
            ),
    };
}

export interface OutputConfig {
    readonly forms: string;
    readonly actions?: string;
}

export interface FormbraidConfig<E = never, R = never> {
    readonly sources: Readonly<Record<string, SourceDriver<E, R>>>;
    readonly submissions?: Readonly<Record<string, SubmissionGenerator<E, R>>>;
    readonly framework: FrameworkDriver;
    readonly output: OutputConfig;
}

export function defineConfig<const C extends FormbraidConfig<unknown, unknown>>(config: C): C {
    return config;
}
