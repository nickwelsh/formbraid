import { defineForm, getValue, isJsonValue } from '@formbraid/core';
import type { FormDefinition, JsonValue, Option, OptionInputReference, FormSession } from '@formbraid/core';
import {
    createContext,
    createElement,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useState,
    useSyncExternalStore,
} from 'react';
import type { ComponentType, ReactNode } from 'react';
import { FieldContext, useSelection } from './hooks.js';

export interface ResolvedOptionInput {
    readonly reference: OptionInputReference;
    readonly present: boolean;
    readonly value?: JsonValue;
}

/** Pending may retain usable data for the SAME arguments during a refresh. */
export interface OptionListState {
    readonly status: 'idle' | 'pending' | 'complete' | 'error';
    readonly items: ReadonlyArray<Option>;
    readonly error?: unknown;
}

export type OptionSelectionState =
    | { readonly status: 'idle' | 'pending'; readonly item?: Option }
    | { readonly status: 'complete'; readonly item: Option }
    | { readonly status: 'unavailable' }
    | { readonly status: 'error'; readonly error: unknown };

export type OptionSourceProps = {
    readonly inputs: ReadonlyArray<ResolvedOptionInput>;
    readonly enabled: boolean;
} & (
    | {
          readonly operation: 'list';
          readonly children: (state: OptionListState) => ReactNode;
      }
    | {
          readonly operation: 'resolve';
          readonly selectedValue: string | number | undefined;
          readonly children: (state: OptionSelectionState) => ReactNode;
      }
);

/** Mount hooks unconditionally inside this component; use enabled to pause provider work. */
export type OptionSourceAdapter = ComponentType<OptionSourceProps>;
export interface OptionSourceBinding {
    readonly bindings: Readonly<Record<string, OptionSourceAdapter>>;
    readonly context: Readonly<Record<string, JsonValue>>;
}

export interface WithOptionSources {
    readonly optionSources: OptionSourceBinding;
}

/** Keeps the producer's exact descriptor type, including output/result inference. */
export function withOptionSources<
    T extends {
        readonly definition: Pick<FormDefinition, 'id' | 'fields' | 'groups' | 'defaultValues'>;
    },
>(
    descriptor: T,
    bindings: OptionSourceBinding['bindings'],
    context: OptionSourceBinding['context'] = {},
): T & WithOptionSources {
    defineForm<object>()(descriptor.definition);
    for (const field of Object.values(descriptor.definition.fields)) {
        if (field.options?.kind === 'source' && !Object.hasOwn(bindings, field.options.id)) {
            throw new Error(`${descriptor.definition.id}.${field.name}: missing option source ${field.options.id}.`);
        }
    }
    if (!isJsonValue(context)) {
        throw new Error('Option source context must contain only JSON values.');
    }
    return { ...descriptor, optionSources: { bindings, context } };
}

interface SnapshotStore<T> {
    readonly subscribe: (listener: () => void) => () => void;
    readonly getSnapshot: () => T;
    readonly publish: (state: T) => void;
}

function snapshotStore<T>(initial: T): SnapshotStore<T> {
    let snapshot = initial;
    const listeners = new Set<() => void>();
    return {
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getSnapshot: () => snapshot,
        publish: (next) => {
            if (!Object.is(snapshot, next)) {
                snapshot = next;
                for (const listener of listeners) {
                    listener();
                }
            }
        },
    };
}

interface AdapterMount {
    readonly key: string;
    readonly node: ReactNode;
}
interface OptionsRuntime {
    readonly definition: Pick<FormDefinition, 'id' | 'fields'>;
    readonly sources: OptionSourceBinding | undefined;
    readonly mount: (entry: AdapterMount) => () => void;
}
const OptionsContext = createContext<OptionsRuntime | null>(null);

/** Per mounted form, not a registry or a provider-data cache. */
export function OptionSourcesProvider({
    definition,
    sources,
    children,
}: {
    readonly definition: Pick<FormDefinition, 'id' | 'fields'>;
    readonly sources: OptionSourceBinding | undefined;
    readonly children: ReactNode;
}): ReactNode {
    // oxlint-disable-next-line react/hook-use-state -- Mount ownership is an external store, created once per form.
    const [mounts] = useState(() => {
        const store = snapshotStore<ReadonlyArray<AdapterMount>>([]);
        let sequence = 0;
        return {
            store,
            mount: (entry: AdapterMount) => {
                sequence += 1;
                const mounted = { ...entry, key: `${entry.key}:${sequence}` };
                store.publish([...store.getSnapshot(), mounted]);
                return () => {
                    store.publish(store.getSnapshot().filter((candidate) => candidate !== mounted));
                };
            },
        };
    });
    const runtime = useMemo(
        () => ({
            definition,
            sources,
            mount: mounts.mount,
        }),
        [definition, sources, mounts],
    );
    return (
        <OptionsContext value={runtime}>
            {children}
            <AdapterMounts store={mounts.store} />
        </OptionsContext>
    );
}

function AdapterMounts({ store }: { readonly store: SnapshotStore<ReadonlyArray<AdapterMount>> }): ReactNode {
    const entries = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    return entries.map((entry) => <AdapterMountNode key={entry.key}>{entry.node}</AdapterMountNode>);
}
function AdapterMountNode({ children }: { readonly children: ReactNode }): ReactNode {
    return children;
}

function Publish<T>({ state, store }: { readonly state: T; readonly store: SnapshotStore<T> }): ReactNode {
    useLayoutEffect(() => {
        store.publish(state);
    }, [state, store]);
    return null;
}

const noInputs: ReadonlyArray<OptionInputReference> = Object.freeze([]);
const noContext: OptionSourceBinding['context'] = Object.freeze({});

function resolveInput(
    reference: OptionInputReference,
    values: unknown,
    { context, local }: { readonly context: OptionSourceBinding['context']; readonly local?: JsonValue | undefined },
): ResolvedOptionInput {
    let value: unknown = local;
    if (reference.kind === 'field') {
        value = getValue(values, reference.path);
    } else if (reference.kind === 'context') {
        value = Object.hasOwn(context, reference.key) ? context[reference.key] : undefined;
    }
    if (value === undefined) {
        return { reference, present: false };
    }
    if (!isJsonValue(value)) {
        throw new Error('Option source inputs must contain only JSON values.');
    }
    return { reference, present: true, value };
}

function useResolvedInputs({
    session,
    references,
    context = noContext,
    local,
}: {
    readonly session: FormSession<Record<string, unknown>>;
    readonly references: ReadonlyArray<OptionInputReference>;
    readonly context?: OptionSourceBinding['context'] | undefined;
    readonly local?: JsonValue | undefined;
}): ReadonlyArray<ResolvedOptionInput> {
    const selector = useMemo(
        () => (state: { readonly values: object }) =>
            JSON.stringify(references.map((reference) => resolveInput(reference, state.values, { context, local }))),
        [references, context, local],
    );
    // A primitive snapshot also survives selector changes (e.g. undeclared local input,
    // or a newly allocated but equivalent JSON input object) without restarting work.
    const snapshot = useSelection(session, selector);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only the validated JSON references/values immediately above are decoded here.
    return useMemo(() => JSON.parse(snapshot) as ReadonlyArray<ResolvedOptionInput>, [snapshot]);
}

function useOperation<T>(
    owner: { readonly adapter: OptionSourceAdapter | undefined; readonly runtime: OptionsRuntime },
    props: OptionSourceProps,
    initial: T,
): T {
    const id = useId();
    // Each argument generation gets its own state cell. Late publications cannot reach its successor.
    const request = useMemo(() => ({ owner, props, store: snapshotStore(initial) }), [owner, props, initial]);
    const { store } = request;
    useEffect(() => {
        const { adapter, runtime } = request.owner;
        if (adapter === undefined) {
            return () => {
                /* No live adapter was mounted. */
            };
        }
        const children = (state: T) => <Publish state={state} store={store} />;
        // The discriminated props union is checked at each call site below.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The two call sites pair operation with its normalized state type.
        const node = createElement(adapter, { ...request.props, children } as OptionSourceProps);
        return runtime.mount({ key: id, node });
    }, [request, store, id]);
    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

const pendingList: OptionListState = { status: 'pending', items: [] };
const idleList: OptionListState = { status: 'idle', items: [] };
const pendingSelection: OptionSelectionState = { status: 'pending' };
const idleSelection: OptionSelectionState = { status: 'idle' };

function staticSelection(items: ReadonlyArray<Option>, selected: string | number | undefined): OptionSelectionState {
    if (selected === undefined) {
        return idleSelection;
    }
    const item = items.find((candidate) => candidate.value === selected);
    return item === undefined ? { status: 'unavailable' } : { status: 'complete', item };
}

function optionConfiguration(runtime: OptionsRuntime, name: string) {
    const field = Object.values(runtime.definition.fields).find((candidate) => candidate.name === name);
    const options = field?.options;
    const source = options?.kind === 'source' ? options : undefined;
    const adapter = source === undefined ? undefined : runtime.sources?.bindings[source.id];
    if (source !== undefined && adapter === undefined) {
        throw new Error(`${runtime.definition.id}.${name}: missing option source ${source.id}.`);
    }
    return {
        options,
        source,
        adapter,
        inputs: source?.inputs ?? noInputs,
        resolveInputs: source?.resolveInputs ?? noInputs,
        context: runtime.sources?.context,
    };
}

/** Local value is control input, NEVER the selected draft ID. enabled only gates listing. */
export function useFieldOptions({
    value,
    enabled = true,
}: { readonly value?: JsonValue | undefined; readonly enabled?: boolean } = {}): {
    readonly listing: OptionListState;
    readonly selection: OptionSelectionState;
} {
    const field = useContext(FieldContext);
    const runtime = useContext(OptionsContext);
    if (field === null || runtime === null) {
        throw new Error('useFieldOptions must be used inside a Formbraid field.');
    }
    const owner = useMemo(() => ({ ...optionConfiguration(runtime, field.name), runtime }), [runtime, field.name]);
    const { options, source } = owner;
    const inputs = useResolvedInputs({
        session: field.session,
        references: owner.inputs,
        context: owner.context,
        local: value,
    });
    const resolveInputs = useResolvedInputs({
        session: field.session,
        references: owner.resolveInputs,
        context: owner.context,
    });
    const selectedSelector = useMemo(() => () => field.session.getField(field.name).value, [field]);
    const selected = useSelection(field.session, selectedSelector);
    const selectedValue = typeof selected === 'string' || typeof selected === 'number' ? selected : undefined;
    const listProps = useMemo(
        () => ({ operation: 'list' as const, inputs, enabled, children: () => null }),
        [inputs, enabled],
    );
    const resolveProps = useMemo(
        () => ({
            operation: 'resolve' as const,
            inputs: resolveInputs,
            enabled: selectedValue !== undefined,
            selectedValue,
            children: () => null,
        }),
        [resolveInputs, selectedValue],
    );
    const listing = useOperation<OptionListState>(owner, listProps, enabled ? pendingList : idleList);
    const selection = useOperation<OptionSelectionState>(
        owner,
        resolveProps,
        selectedValue === undefined ? idleSelection : pendingSelection,
    );
    if (source !== undefined) {
        return {
            listing: enabled ? listing : { status: 'idle', items: [] },
            selection: selectedValue === undefined ? { status: 'idle' } : selection,
        };
    }
    const items = options?.kind === 'static' ? options.items : [];
    return {
        listing: { status: 'complete', items },
        selection: staticSelection(items, selectedValue),
    };
}
