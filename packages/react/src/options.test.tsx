import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import type { FieldDefinition, FormDescriptor, JsonValue, Option, SubmissionCallback } from '@formbraid/core';
import { Context, Effect, Schema } from 'effect';
import { defineConfig } from './create-formbraid.js';
import { createEffectOptionSource } from './effect-options.js';
import { useFieldContext, useFormContext } from './hooks.js';
import { useFieldOptions, withOptionSources } from './options.js';
import type { OptionListState, OptionSelectionState, OptionSourceAdapter, OptionSourceProps } from './options.js';

vi.setConfig({ testTimeout: 10_000 });

interface Values {
    readonly organization: number | null;
    readonly party: number | null;
    readonly unrelated: string;
    readonly nested: { readonly flag: boolean };
}
const source = {
    kind: 'source',
    id: 'PartyRequest:party',
    inputs: [{ kind: 'value' }, { kind: 'field', path: 'organization' }, { kind: 'context', key: 'parent' }],
    resolveInputs: [
        { kind: 'field', path: 'organization' },
        { kind: 'field', path: 'party' },
        { kind: 'context', key: 'parent' },
    ],
} as const;
const party = {
    name: 'party',
    type: 'integer',
    label: 'Party',
    component: 'Picker',
    props: {},
    constraints: {},
    nullable: true,
    serverRules: [],
    options: source,
} as const satisfies FieldDefinition;
const definition = {
    id: 'PartyRequest',
    defaultValues: { organization: 1, party: 99, unrelated: '', nested: { flag: false } },
    groups: {},
};

/** Accessible, unstyled test control: query text and the selected ID have separate owners. */
function Picker({ label = 'Party' }: { readonly label?: string }) {
    const field = useFieldContext<number | null>();
    const [value, setValue] = useState('');
    const [enabled, setEnabled] = useState(false);
    const { listing, selection } = useFieldOptions({ value, enabled });
    return (
        <fieldset aria-label={label}>
            <legend>{label}</legend>
            <label>
                Filter{' '}
                <input
                    aria-label={`${label} filter`}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                />
            </label>
            <button type="button" onClick={() => setEnabled(!enabled)}>
                {enabled ? 'Close' : 'Open'}
            </button>
            <output aria-label="Selected ID">{field.value ?? 'none'}</output>
            <output aria-label="Selection">
                {selection.status}
                {'item' in selection ? `:${selection.item.label}` : ''}
            </output>
            <output aria-label="Listing">{listing.status}</output>
            {enabled && (
                <select
                    aria-label={`${label} results`}
                    value=""
                    onChange={(event) => {
                        const item = listing.items.find((candidate) => String(candidate.value) === event.target.value);
                        if (typeof item?.value === 'number') {
                            field.setValue(item.value);
                        }
                    }}
                >
                    <option value="">Choose</option>
                    {listing.items.map((item) => (
                        <option key={item.value} value={item.value} disabled={item.disabled}>
                            {item.label}
                        </option>
                    ))}
                </select>
            )}
        </fieldset>
    );
}
function Actions() {
    const form = useFormContext<Values>();
    return (
        <>
            <button type="button" onClick={() => form.setFieldValue('organization', 2)}>
                Organization B
            </button>
            <button type="button" onClick={() => form.setFieldValue('unrelated', 'edited')}>
                Unrelated edit
            </button>
            <button type="button" onClick={() => form.reset()}>
                Reset
            </button>
            <button type="submit">Save</button>
        </>
    );
}
function Probe({ query }: { readonly query?: JsonValue }) {
    const state = useFieldOptions(query === undefined ? {} : { value: query });
    return <output aria-label="Source state">{JSON.stringify(state)}</output>;
}
function ObjectInput() {
    const state = useFieldOptions({ value: { filter: 'same', flags: [false, 0] } });
    return <output aria-label="Source state">{JSON.stringify(state)}</output>;
}
const { Form, useForm } = defineConfig({
    components: { Picker, Probe, ObjectInput },
    formComponents: { Actions },
    submitComponent: 'Actions',
});

function connection(props: OptionSourceProps) {
    let listing: OptionListState = { status: props.enabled ? 'pending' : 'idle', items: [] };
    let selection: OptionSelectionState = { status: props.enabled ? 'pending' : 'idle' };
    const listeners = new Set<() => void>();
    let active = false;
    return {
        props,
        get active() {
            return active;
        },
        mount: () => {
            active = true;
        },
        dispose: () => {
            active = false;
        },
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getList: () => listing,
        getSelection: () => selection,
        list: (next: OptionListState) => {
            listing = next;
            for (const listener of listeners) {
                listener();
            }
        },
        resolve: (next: OptionSelectionState) => {
            selection = next;
            for (const listener of listeners) {
                listener();
            }
        },
    };
}
function fakeProvider() {
    const connections: Array<ReturnType<typeof connection>> = [];
    function Adapter(props: OptionSourceProps): ReactNode {
        const feed = useMemo(() => connection(props), [props]);
        useEffect(() => {
            connections.push(feed);
            feed.mount();
            return () => {
                feed.dispose();
            };
        }, [feed]);
        const listing = useSyncExternalStore(feed.subscribe, feed.getList, feed.getList);
        const selection = useSyncExternalStore(feed.subscribe, feed.getSelection, feed.getSelection);
        return props.operation === 'list' ? props.children(listing) : props.children(selection);
    }
    return {
        Adapter,
        connections,
        active: (operation: 'list' | 'resolve') =>
            connections.filter((feed) => feed.active && feed.props.operation === operation),
        current: (operation: 'list' | 'resolve', index = 0) => {
            const feed = connections.filter((candidate) => candidate.active && candidate.props.operation === operation)[
                index
            ];
            if (feed === undefined) {
                throw new Error(`Missing ${operation} connection`);
            }
            return feed;
        },
    };
}
const defaultContext = { parent: 7 };

function descriptor(
    provider: { readonly Adapter: OptionSourceAdapter },
    context: Readonly<Record<string, JsonValue>> = defaultContext,
) {
    const submit = vi.fn<SubmissionCallback<Values>>(() => ({ status: 'success' }));
    // Keep every definition portable (no undefined metadata keys).
    const fields = { party };
    const bound: FormDescriptor<Values, typeof fields, typeof definition.groups> = {
        version: 1,
        definition: { ...definition, fields },
        submission: { submit },
    };
    return { form: withOptionSources(bound, { [source.id]: provider.Adapter }, context), submit };
}
const alpha: Option = { value: 3, label: 'Alpha' };
const beta: Option = { value: 8, label: 'Beta' };

describe('field option sources', () => {
    afterEach(cleanup);

    it('resolves a prefilled ID while closed and streams listing updates without editing that ID', async () => {
        expect.hasAssertions();
        const provider = fakeProvider();
        const bound = descriptor(provider);
        render(<Form form={bound.form} />);
        const resolver = provider.current('resolve');
        expect([
            provider.current('list').props.enabled,
            provider.current('resolve').props.enabled,
            screen.getByLabelText('Selection').textContent,
        ]).toStrictEqual([false, true, 'pending']);
        act(() =>
            provider.current('resolve').resolve({ status: 'complete', item: { value: 99, label: 'Outside window' } }),
        );
        expect(screen.getByLabelText('Selection').textContent).toBe('complete:Outside window');
        fireEvent.change(screen.getByLabelText('Party filter'), { target: { value: 'al' } });
        fireEvent.click(screen.getByText('Open'));
        const feed = provider.current('list');
        act(() => feed.list({ status: 'complete', items: [alpha] }));
        expect({
            input: feed.props.inputs[0],
            label: screen.getByRole('option', { name: 'Alpha' }).textContent,
            sameResolver: provider.current('resolve') === resolver,
        }).toStrictEqual({
            input: { reference: { kind: 'value' }, present: true, value: 'al' },
            label: 'Alpha',
            sameResolver: true,
        });
        act(() => feed.list({ status: 'pending', items: [beta] }));
        expect({
            options: screen.getAllByRole('option').map((option) => option.textContent),
            listing: screen.getByLabelText('Listing').textContent,
            id: screen.getByLabelText('Selected ID').textContent,
        }).toStrictEqual({ options: ['Choose', 'Beta'], listing: 'pending', id: '99' });
        fireEvent.change(screen.getByLabelText('Party results'), { target: { value: '8' } });
        act(() => feed.list({ status: 'complete', items: [] }));
        fireEvent.click(screen.getByText('Save'));
        await act(async () => {
            await Promise.resolve();
        });
        expect({
            submitted: bound.submit.mock.calls[0]?.[0],
            filter: screen.getByLabelText<HTMLInputElement>('Party filter').value,
        }).toStrictEqual({
            submitted: {
                organization: 1,
                party: 8,
                unrelated: '',
                nested: { flag: false },
            },
            filter: 'al',
        });
    });

    it('invalidates A immediately, rejects late A snapshots, preserves IDs, and ignores unrelated edits', () => {
        expect.hasAssertions();
        const provider = fakeProvider();
        render(<Form form={descriptor(provider).form} />);
        fireEvent.click(screen.getByText('Open'));
        const old = provider.current('list');
        act(() => old.list({ status: 'complete', items: [alpha] }));
        fireEvent.click(screen.getByText('Unrelated edit'));
        expect(provider.current('list')).toBe(old);
        fireEvent.click(screen.getByText('Organization B'));
        expect({
            active: old.active,
            obsolete: screen.queryByRole('option', { name: 'Alpha' }),
            listing: screen.getByLabelText('Listing').textContent,
            organization: provider.current('list').props.inputs[1]?.value,
        }).toStrictEqual({ active: false, obsolete: null, listing: 'pending', organization: 2 });
        act(() => old.list({ status: 'complete', items: [alpha] }));
        expect(screen.queryByRole('option', { name: 'Alpha' })).toBeNull();
        act(() => provider.current('resolve').resolve({ status: 'unavailable' }));
        expect([
            screen.getByLabelText('Selection').textContent,
            screen.getByLabelText('Selected ID').textContent,
        ]).toStrictEqual(['unavailable', '99']);
        fireEvent.click(screen.getByText('Reset'));
        expect([
            provider.current('list').props.inputs[1]?.value,
            screen.getByLabelText('Selection').textContent,
        ]).toStrictEqual([1, 'pending']);
    });

    it('preserves bindings through useForm, isolates forms/context and cleans StrictMode mounts', () => {
        expect.hasAssertions();
        const provider = fakeProvider();
        const first = descriptor(provider, { parent: 10 }).form;
        const second = descriptor(provider, { parent: 20 }).form;
        function Instance() {
            const instance = useForm(first);
            return <Form form={instance} aria-label="First" />;
        }
        const mounted = render(
            <StrictMode>
                <Instance />
                <Form form={second} aria-label="Second" />
            </StrictMode>,
        );
        const one = within(screen.getByRole('form', { name: 'First' }));
        const two = within(screen.getByRole('form', { name: 'Second' }));
        fireEvent.change(one.getByLabelText('Party filter'), { target: { value: 'one' } });
        fireEvent.change(two.getByLabelText('Party filter'), { target: { value: 'two' } });
        const inputs = provider.active('list').map((feed) => feed.props.inputs.map((input) => input.value));
        expect(inputs).toContainEqual(['one', 1, 10]);
        expect(inputs).toContainEqual(['two', 1, 20]);
        mounted.unmount();
        expect(provider.connections.filter((feed) => feed.active)).toHaveLength(0);
    });

    it('keeps two control-local values isolated even for the same field', () => {
        expect.hasAssertions();
        const provider = fakeProvider();
        render(
            <Form form={descriptor(provider).form}>
                {({ fields }) => (
                    <>
                        <fields.party label="One" />
                        <fields.party label="Two" />
                    </>
                )}
            </Form>,
        );
        fireEvent.change(screen.getByLabelText('One filter'), { target: { value: 'one' } });
        fireEvent.change(screen.getByLabelText('Two filter'), { target: { value: 'two' } });
        expect(provider.active('list').map((feed) => feed.props.inputs[0]?.value)).toStrictEqual(['one', 'two']);
    });

    it('has deterministic SSR pending state without mounting a provider', () => {
        expect.hasAssertions();
        const provider = fakeProvider();
        const bound = descriptor(provider).form;
        const first = renderToString(<Form form={bound} />);
        expect(first).toContain('pending');
        expect(first).not.toContain('Outside window');
        expect(provider.connections).toHaveLength(0);
        expect(renderToString(<Form form={bound} />)).toBe(first);
    });

    it.each([0, ''])('resolves the falsy selected ID %j while closed', (selectedValue) => {
        expect.hasAssertions();
        const provider = fakeProvider();
        const bound = withOptionSources(
            {
                version: 1 as const,
                definition: {
                    ...definition,
                    defaultValues: { ...definition.defaultValues, party: selectedValue },
                    fields: { party },
                },
                submission: { submit: () => ({ status: 'success' as const }) },
            },
            { [source.id]: provider.Adapter },
        );
        render(<Form form={bound} />);
        const resolver = provider.current('resolve');
        expect(resolver.props).toMatchObject({ operation: 'resolve', selectedValue, enabled: true });
        act(() => resolver.resolve({ status: 'complete', item: { value: selectedValue, label: 'Falsy ID label' } }));
        expect(screen.getByLabelText('Selection').textContent).toBe('complete:Falsy ID label');
        expect(provider.current('list').props.enabled).toBe(false);
    });

    it.each([
        { name: 'zero', props: { query: 0 }, expected: { present: true, value: 0 } },
        { name: 'false', props: { query: false }, expected: { present: true, value: false } },
        { name: 'empty string', props: { query: '' }, expected: { present: true, value: '' } },
        { name: 'absent', props: {}, expected: { present: false } },
    ])('distinguishes absent inputs from the falsy local value $name', ({ props, expected }) => {
        expect.hasAssertions();
        const provider = fakeProvider();
        const base = descriptor(provider, {}).form;
        const fields = {
            party: {
                ...party,
                component: 'Probe' as const,
                props,
                options: {
                    ...source,
                    inputs: [
                        { kind: 'value' as const },
                        { kind: 'field' as const, path: 'nested.flag' },
                        { kind: 'context' as const, key: 'absent' },
                    ],
                },
            },
        };
        render(
            <Form
                form={{
                    ...base,
                    definition: {
                        ...base.definition,
                        defaultValues: { ...base.definition.defaultValues, party: null },
                        fields,
                    },
                }}
            />,
        );
        expect(provider.current('list').props.inputs).toStrictEqual([
            {
                reference: { kind: 'value' },
                ...expected,
            },
            { reference: { kind: 'field', path: 'nested.flag' }, present: true, value: false },
            { reference: { kind: 'context', key: 'absent' }, present: false },
        ]);
        expect([provider.current('list').props.enabled, provider.current('resolve').props.enabled]).toStrictEqual([
            true,
            false,
        ]);
    });

    it('runs a source with no local-value dependency and distinguishes empty pending, complete and errors', () => {
        expect.hasAssertions();
        const provider = fakeProvider();
        const base = descriptor(provider).form;
        const fields = {
            party: {
                ...party,
                component: 'Probe' as const,
                options: { ...source, inputs: [{ kind: 'field' as const, path: 'organization' }] },
            },
        };
        render(<Form form={{ ...base, definition: { ...base.definition, fields } }} />);
        const listing = provider.current('list');
        expect(listing.props.inputs).toStrictEqual([
            { reference: { kind: 'field', path: 'organization' }, present: true, value: 1 },
        ]);
        expect(screen.getByLabelText('Source state').textContent).toContain(
            '"listing":{"status":"pending","items":[]}',
        );
        act(() => listing.list({ status: 'complete', items: [] }));
        expect(screen.getByLabelText('Source state').textContent).toContain(
            '"listing":{"status":"complete","items":[]}',
        );
        act(() => listing.list({ status: 'error', items: [], error: 'offline' }));
        act(() => provider.current('resolve').resolve({ status: 'error', error: 'forbidden' }));
        expect(JSON.parse(screen.getByLabelText('Source state').textContent)).toStrictEqual({
            listing: { status: 'error', items: [], error: 'offline' },
            selection: { status: 'error', error: 'forbidden' },
        });
    });

    it('does not replace a source when an undeclared local value changes', () => {
        expect.hasAssertions();
        const provider = fakeProvider();
        const base = descriptor(provider).form;
        const fields = {
            party: { ...party, options: { ...source, inputs: [{ kind: 'field' as const, path: 'organization' }] } },
        };
        render(<Form form={{ ...base, definition: { ...base.definition, fields } }} />);
        fireEvent.click(screen.getByText('Open'));
        const listing = provider.current('list');
        act(() => listing.list({ status: 'complete', items: [alpha] }));
        fireEvent.change(screen.getByLabelText('Party filter'), { target: { value: 'not a declared input' } });
        expect(provider.current('list')).toBe(listing);
        expect(screen.getByRole('option', { name: 'Alpha' }).textContent).toBe('Alpha');
    });

    it('keeps equivalent JSON local inputs stable across live renders', () => {
        expect.hasAssertions();
        const provider = fakeProvider();
        const base = descriptor(provider).form;
        const fields = { party: { ...party, component: 'ObjectInput' as const } };
        render(<Form form={{ ...base, definition: { ...base.definition, fields } }} />);
        const listing = provider.current('list');
        act(() => listing.list({ status: 'complete', items: [alpha] }));
        expect(provider.current('list')).toBe(listing);
        expect(listing.props.inputs[0]?.value).toStrictEqual({ filter: 'same', flags: [false, 0] });
        expect(screen.getByLabelText('Source state').textContent).toContain('Alpha');
    });

    it('allows a provider to pause missing local input without pausing selected-ID resolution', () => {
        expect.hasAssertions();
        const provider = fakeProvider();
        const base = descriptor(provider).form;
        const fields = { party: { ...party, component: 'Probe' as const } };
        render(<Form form={{ ...base, definition: { ...base.definition, fields } }} />);
        expect(provider.current('list').props.inputs[0]).toStrictEqual({
            reference: { kind: 'value' },
            present: false,
        });
        expect(provider.current('resolve').props.enabled).toBe(true);
        act(() => provider.current('list').list({ status: 'idle', items: [] }));
        act(() => provider.current('resolve').resolve({ status: 'complete', item: { value: 99, label: 'Prefilled' } }));
        expect(JSON.parse(screen.getByLabelText('Source state').textContent)).toStrictEqual({
            listing: { status: 'idle', items: [] },
            selection: { status: 'complete', item: { value: 99, label: 'Prefilled' } },
        });
    });

    it('renders static labels and disabled items without creating a source or narrowing validation', async () => {
        expect.hasAssertions();
        const provider = fakeProvider();
        const base = descriptor(provider);
        const fields = {
            party: { ...party, options: { kind: 'static' as const, items: [alpha, { ...beta, disabled: true }] } },
        };
        render(<Form form={{ ...base.form, definition: { ...base.form.definition, fields } }} />);
        fireEvent.click(screen.getByText('Open'));
        expect(
            screen.getAllByRole<HTMLOptionElement>('option').map((option) => [option.textContent, option.disabled]),
        ).toStrictEqual([
            ['Choose', false],
            ['Alpha', false],
            ['Beta', true],
        ]);
        fireEvent.click(screen.getByText('Save'));
        await act(async () => {
            await Promise.resolve();
        });
        expect(base.submit.mock.calls[0]?.[0]?.party).toBe(99);
        expect(provider.connections).toHaveLength(0);
    });

    it('isolates replacement descriptor context, adapter and selected ID generations', () => {
        expect.hasAssertions();
        const provider = fakeProvider();
        const base = descriptor(provider).form;
        const mounted = render(<Form form={base} />);
        fireEvent.click(screen.getByText('Open'));
        const oldList = provider.current('list');
        const oldResolve = provider.current('resolve');
        act(() => oldList.list({ status: 'complete', items: [alpha] }));
        const replacement = fakeProvider();
        const next = withOptionSources(base, { [source.id]: replacement.Adapter }, { parent: 88 });
        mounted.rerender(<Form form={next} />);
        act(() => oldList.list({ status: 'complete', items: [alpha] }));
        act(() => oldResolve.resolve({ status: 'complete', item: alpha }));
        expect([
            oldList.active,
            oldResolve.active,
            screen.queryByRole('option', { name: 'Alpha' }),
            screen.getByLabelText('Selection').textContent,
        ]).toStrictEqual([false, false, null, 'pending']);
        expect(replacement.current('list').props.inputs[2]?.value).toBe(88);
        act(() => replacement.current('list').list({ status: 'complete', items: [beta] }));
        const resolver = replacement.current('resolve');
        fireEvent.change(screen.getByLabelText('Party results'), { target: { value: '8' } });
        act(() => resolver.resolve({ status: 'complete', item: { value: 99, label: 'Stale selection' } }));
        expect([
            resolver.active,
            screen.getByLabelText('Selected ID').textContent,
            screen.getByLabelText('Selection').textContent,
        ]).toStrictEqual([false, '8', 'pending']);
    });
});

describe('effect option sources', () => {
    afterEach(cleanup);

    it.each([0, ''])('resolves selected ID %j with application services', async (id) => {
        expect.hasAssertions();
        // oxlint-disable-next-line eslint/new-cap -- Effect's service constructor is capitalized.
        const Labels = Context.Service<{ readonly prefix: string }>('options/Labels');
        const Adapter = createEffectOptionSource({
            list: { input: () => true, load: () => Effect.succeed([]) },
            resolve: {
                input: () => true,
                load: (_input, value) =>
                    Labels.pipe(Effect.map((labels) => ({ value, label: `${labels.prefix}${value}` }))),
            },
            run: Effect.runPromiseWith(Context.make(Labels, { prefix: 'Customer ' })),
        });
        render(
            <Adapter operation="resolve" inputs={[]} enabled selectedValue={id}>
                {(state) => JSON.stringify(state)}
            </Adapter>,
        );
        await screen.findByText(JSON.stringify({ status: 'complete', item: { value: id, label: `Customer ${id}` } }));
        expect(screen.getByText(/Customer/u).textContent).toContain(`"value":${JSON.stringify(id)}`);
    });

    it('interrupts obsolete searches and scoped resources without publishing late results', async () => {
        expect.hasAssertions();
        const requests: Array<{
            query: string;
            signal: AbortSignal;
            complete: (items: ReadonlyArray<Option>) => void;
        }> = [];
        let resources = 0;
        const Adapter = createEffectOptionSource({
            list: {
                input: (inputs) => Schema.decodeUnknownSync(Schema.String)(inputs[0]?.value),
                load: (query) =>
                    Effect.acquireRelease(
                        Effect.sync(() => {
                            resources += 1;
                        }),
                        () =>
                            Effect.sync(() => {
                                resources -= 1;
                            }),
                    ).pipe(
                        Effect.flatMap(() =>
                            Effect.promise(
                                async (signal) =>
                                    await new Promise<ReadonlyArray<Option>>((resolve) => {
                                        requests.push({ query, signal, complete: resolve });
                                    }),
                            ),
                        ),
                    ),
            },
        });
        const { form } = descriptor({ Adapter });
        const view = render(
            <StrictMode>
                <Form form={form} />
            </StrictMode>,
        );
        expect(resources).toBe(0);
        fireEvent.click(screen.getByText('Open'));
        const first = requests.at(-1);
        fireEvent.change(screen.getByLabelText('Party filter'), { target: { value: 'be' } });
        const second = requests.at(-1);
        expect([first?.query, first?.signal.aborted, second?.query, resources]).toStrictEqual(['', true, 'be', 1]);
        await act(async () => {
            first?.complete([alpha]);
            await Promise.resolve();
        });
        expect([
            screen.queryByRole('option', { name: 'Alpha' }),
            screen.getByLabelText('Listing').textContent,
        ]).toStrictEqual([null, 'pending']);
        await act(async () => {
            second?.complete([beta]);
            await Promise.resolve();
        });
        expect(screen.getByRole('option', { name: 'Beta' }).textContent).toBe('Beta');
        fireEvent.click(screen.getByText('Organization B'));
        const third = requests.at(-1);
        view.unmount();
        await act(async () => {
            third?.complete([alpha]);
            await Promise.resolve();
        });
        expect([third?.signal.aborted, resources]).toStrictEqual([true, 0]);
    });

    it.each([
        {
            name: 'missing inputs',
            input: (): undefined => {
                /* Not ready. */
            },
            load: () => Effect.succeed([alpha]),
            status: 'idle',
        },
        { name: 'empty results', input: () => true, load: () => Effect.succeed([]), status: 'complete' },
        { name: 'failed request', input: () => true, load: () => Effect.fail('offline'), status: 'error' },
        {
            name: 'invalid input',
            input: (): boolean => Schema.decodeUnknownSync(Schema.Boolean)('bad'),
            load: () => Effect.succeed([alpha]),
            status: 'error',
        },
    ])('reports $name without confusing it with completed empty results', async ({ input, load, status }) => {
        expect.hasAssertions();
        const Adapter = createEffectOptionSource({ list: { input, load } });
        const { form } = descriptor({ Adapter });
        render(<Form form={form} />);
        fireEvent.click(screen.getByText('Open'));
        await screen.findByText(status, { selector: 'output[aria-label="Listing"]' });
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(screen.getByLabelText('Selection').textContent).toBe('unavailable');
    });

    it('reports a missing selected record as unavailable without clearing its ID', async () => {
        expect.hasAssertions();
        const Adapter = createEffectOptionSource({
            list: { input: () => true, load: () => Effect.succeed([alpha]) },
            resolve: { input: () => true, load: () => Effect.succeed(null) },
        });
        const { form } = descriptor({ Adapter });
        render(<Form form={form} />);
        await screen.findByText('unavailable');
        expect(screen.getByLabelText('Selected ID').textContent).toBe('99');
    });

    it('skips a disabled runner and reports runner acquisition errors when enabled', async () => {
        expect.hasAssertions();
        const Adapter = createEffectOptionSource({
            list: { input: () => true, load: () => Effect.succeed([alpha]) },
            run: () => {
                throw new Error('runtime unavailable');
            },
        });
        const view = render(
            <Adapter operation="list" inputs={[]} enabled={false}>
                {(state) => `${state.status}:${String(state.error)}`}
            </Adapter>,
        );
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.getByText('idle:undefined').textContent).toBe('idle:undefined');
        view.rerender(
            <Adapter operation="list" inputs={[]} enabled>
                {(state) => `${state.status}:${String(state.error)}`}
            </Adapter>,
        );
        await screen.findByText('error:Error: runtime unavailable');
        expect(screen.queryByText('idle:undefined')).toBeNull();
    });

    it('does not execute option requests while rendering on the server', () => {
        expect.hasAssertions();
        const Adapter = createEffectOptionSource({
            list: { input: () => true, load: () => Effect.die('SSR must not execute') },
        });
        const html = renderToString(
            <Adapter operation="list" inputs={[]} enabled>
                {(state) => state.status}
            </Adapter>,
        );
        expect(html).toBe('pending');
    });
});
