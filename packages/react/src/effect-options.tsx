/* oxlint-disable typescript/no-unsafe-type-assertion -- Public options enforce runner services; the operation determines the private snapshot type. */
import type { EffectRunner, Option } from '@formbraid/core';
import { Cause, Effect, Equal } from 'effect';
import type { Scope } from 'effect';
import { AtomRef } from 'effect/reactivity';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type {
    OptionListState,
    OptionSelectionState,
    OptionSourceAdapter,
    OptionSourceProps,
    ResolvedOptionInput,
} from './options.js';

export type EffectOptionSourceOptions<TListInput, TResolveInput, TListServices, TResolveServices> = {
    readonly list: {
        readonly input: (inputs: ReadonlyArray<ResolvedOptionInput>) => TListInput | undefined;
        readonly load: (input: NoInfer<TListInput>) => Effect.Effect<ReadonlyArray<Option>, unknown, TListServices>;
    };
    readonly resolve?: {
        readonly input: (inputs: ReadonlyArray<ResolvedOptionInput>) => TResolveInput | undefined;
        readonly load: (
            input: NoInfer<TResolveInput>,
            selectedValue: string | number,
        ) => Effect.Effect<Option | null, unknown, TResolveServices>;
    };
} & ([Exclude<TListServices | TResolveServices, Scope.Scope>] extends [never]
    ? { readonly run?: EffectRunner<Exclude<TListServices | TResolveServices, Scope.Scope>> }
    : { readonly run: EffectRunner<Exclude<TListServices | TResolveServices, Scope.Scope>> });

/** Request-based option loading; provider caches, subscriptions and retry policy remain application-owned. */
export function createEffectOptionSource<
    TListInput,
    TResolveInput = never,
    TListServices = never,
    TResolveServices = never,
>(options: EffectOptionSourceOptions<TListInput, TResolveInput, TListServices, TResolveServices>): OptionSourceAdapter {
    return function EffectOptionSource(props: OptionSourceProps): ReactNode {
        const { operation, inputs, enabled } = props;
        const selectedValue = props.operation === 'resolve' ? props.selectedValue : undefined;
        const request = useMemo(() => {
            const initial: OptionListState | OptionSelectionState =
                operation === 'list'
                    ? { status: enabled ? 'pending' : 'idle', items: [] }
                    : { status: enabled && selectedValue !== undefined ? 'pending' : 'idle' };
            const state = AtomRef.make<OptionListState | OptionSelectionState>(Equal.byReferenceUnsafe(initial));
            const program = Effect.gen(function* load(): Effect.fn.Return<
                OptionListState | OptionSelectionState,
                unknown,
                TListServices | TResolveServices
            > {
                if (!enabled) {
                    return initial;
                }
                if (operation === 'list') {
                    const input = options.list.input(inputs);
                    if (input === undefined) {
                        return { status: 'idle', items: [] };
                    }
                    const items = yield* options.list.load(input);
                    return { status: 'complete', items };
                }
                if (selectedValue === undefined) {
                    return { status: 'idle' };
                }
                if (options.resolve === undefined) {
                    return { status: 'unavailable' };
                }
                const input = options.resolve.input(inputs);
                if (input === undefined) {
                    return { status: 'idle' };
                }
                const item = yield* options.resolve.load(input, selectedValue);
                return item === null ? { status: 'unavailable' } : { status: 'complete', item };
            }).pipe(
                Effect.scoped,
                Effect.catchCause((cause) => Effect.succeed(failure(Cause.squash(cause)))),
            );
            function failure(error: unknown): OptionListState | OptionSelectionState {
                return operation === 'list' ? { status: 'error', items: [], error } : { status: 'error', error };
            }
            return {
                state,
                program,
                failure,
                active: enabled && (operation === 'list' || selectedValue !== undefined),
                subscribe: (listener: () => void) => state.subscribe(listener),
                getSnapshot: () => state.value,
            };
        }, [operation, inputs, enabled, selectedValue]);
        useEffect(() => {
            const controller = new AbortController();
            async function execute(): Promise<void> {
                try {
                    // Service-dependent configurations must supply run; only service-free effects use the fallback.
                    const run = options.run as
                        | EffectRunner<Exclude<TListServices | TResolveServices, Scope.Scope>>
                        | undefined;
                    const state =
                        run === undefined
                            ? await Effect.runPromise(
                                  request.program as Effect.Effect<OptionListState | OptionSelectionState>,
                                  { signal: controller.signal },
                              )
                            : await run(request.program, { signal: controller.signal });
                    if (!controller.signal.aborted) {
                        request.state.set(Equal.byReferenceUnsafe(state));
                    }
                } catch (error) {
                    if (!controller.signal.aborted) {
                        request.state.set(Equal.byReferenceUnsafe(request.failure(error)));
                    }
                }
            }
            if (request.active) {
                void execute();
            }
            return () => controller.abort();
        }, [request]);
        const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot);
        // Each operation constructs only its matching state; the shared store erases that correlation.
        return props.operation === 'list'
            ? props.children(state as OptionListState)
            : props.children(state as OptionSelectionState);
    };
}
