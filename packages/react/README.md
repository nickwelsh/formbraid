# @formbraid/react

Typed React bindings and application-owned components for Formbraid.

```sh
pnpm add @formbraid/core @formbraid/react effect react
```

Configure only application components:

```ts
import { defineConfig } from '@formbraid/react';
import { TextField } from './fields';
import { SubmitButton } from './form-components';

export const { Form, useForm } = defineConfig({
    components: { TextField },
    formComponents: { SubmitButton },
    submitComponent: 'SubmitButton',
});
```

Optional `groups` registers `withFieldGroup` components. Context hooks (`useFieldContext`, `useFormContext`) come directly from this package. Render a definition, callback-backed descriptor, or initialized form instance. Descriptors carry execution; local `submit` callbacks and Effect `operation` / `run` options can override it. There is no runtime submission registry. Build integrations belong exclusively in Vite configuration through `@formbraid/core/vite`.

## Field option sources

Presentation options live in `definition.fields[name].options`, not `constraints.options`. Static declarations need no adapter. A producer attaches executable adapters and JSON context to each descriptor:

```tsx
import { withOptionSources } from '@formbraid/react';
import { PartyRequest } from './generated/PartyRequest';
import { PartyOptions } from './provider/PartyOptions';

export function addRelation(context: { party: number }) {
    return withOptionSources(
        { version: 1 as const, definition: PartyRequest, submission: { submit: saveRelation } },
        { 'App\\Http\\Requests\\PartyRequest:other_party_id': PartyOptions },
        context,
    );
}

<Form form={addRelation({ party: 42 })} />;
```

`withOptionSources(descriptor, bindings, context?)` returns the original descriptor type intersected with `WithOptionSources`; value, field, group, output, success, error, and decoder-service inference survive. Bindings/context also survive `useForm(descriptor)` followed by `<Form form={instance} />`. Keep descriptors, binding objects, and context immutable and stable between renders; construct a new binding/context when identity or captured context changes. There is no global registry.

An application-owned field calls `useFieldOptions({ value?, enabled? })` inside a bound field (or `form.Field`). `value` is JSON-compatible **control-local input**, such as filter text. It is never the selected draft value:

```tsx
function Picker() {
    const field = useFieldContext<string | number | null>();
    const [filter, setFilter] = useState('');
    const { listing, selection } = useFieldOptions({ value: filter, enabled: true });
    return (
        <>
            <input aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <span>{'item' in selection ? selection.item.label : selection.status}</span>
            {listing.items.map((item) => (
                <button
                    type="button"
                    key={item.value}
                    disabled={item.disabled}
                    onClick={() => field.setValue(item.value)}
                >
                    {item.label}
                </button>
            ))}
        </>
    );
}
```

`enabled` defaults to true and gates **listing only**. A selected string/number (including `0` or `''`) resolves independently while closed. Null/undefined selections disable resolution. A source without a `value` reference needs no local input. The hook never edits IDs, turns labels into queries, or treats absence from a limited list as invalidity. Debouncing and explicit clearing policies belong to controls/applications.

### Adapter component contract

Each binding is an `OptionSourceAdapter`, a React component receiving discriminated `OptionSourceProps`:

- Common: `inputs: readonly ResolvedOptionInput[]`, `enabled: boolean`.
- Listing: `operation: 'list'`, `children(state: OptionListState)`.
- Resolution: `operation: 'resolve'`, `selectedValue: string | number | undefined`, `children(state: OptionSelectionState)`.

Each resolved input is `{ reference: OptionInputReference, present: boolean, value?: JsonValue }`. Only declared field paths are observed, from current draft defaults/edits/resets. Context comes from this descriptor. Missing is `present: false`; `null`, `0`, `false`, and `''` are present. The provider validates its compiled input contract and reports `idle` when not ready; it must not validate the whole submission draft. Resolution dependencies must not include local `value` references.

Listing state is `{ status: 'idle' | 'pending' | 'complete' | 'error', items: readonly Option[], error?: unknown }`. Selection state is one of:

- `{ status: 'idle' | 'pending', item?: Option }`
- `{ status: 'complete', item: Option }`
- `{ status: 'unavailable' }` (including a provider that has no selected-ID resolver)
- `{ status: 'error', error: unknown }`

`Option` is `{ value: string | number, label: string, disabled?: boolean }`. Pending with no items is not completed empty data. During refresh, a provider may retain usable items for the **same arguments**. It must never publish obsolete data from a different query/authorization identity as usable current data.

Adapters run as genuine mounted components beneath the form's application providers. Call provider hooks unconditionally, and use `enabled`/validated readiness to pause their work. Return `props.children(normalizedState)` during render; do not invoke hooks or call children from ordinary subscription callbacks. Provider hooks may publish any number of live snapshots. Dispose subscriptions in effect cleanup and gate identity/authorization changes through the provider's existing lifecycle. If an external identity changes outside that lifecycle, replace the descriptor binding/context so Formbraid can invalidate it too.

Each control and operation owns a separate mounted adapter and latest-state cell, **not another query cache**. A dependency, local-input, selected-ID, source, definition, or descriptor-context generation change replaces that operation's state immediately and unmounts its old adapter. Late old results cannot populate the new state. Unrelated field edits and local-input changes not declared by an operation do not replace it. SSR renders deterministic pending/idle states without running adapters; StrictMode setup/cleanup is supported.

See `src/options.test.tsx` for an accessible test control and a fake live provider covering multiple updates, late results, closed selection, isolation, reset, StrictMode, SSR, errors, and missing/falsy inputs. Top-level/concrete nested dependencies are supported. Wildcard-relative/repeater dependencies, automatic clearing, multi-select UI, pagination, retry policy, production styling, and transport adapters are outside this contract.

### Effect-backed requests

`createEffectOptionSource` returns an ordinary `OptionSourceAdapter` for request-based providers. Create it outside render and attach it with `withOptionSources`; existing provider components and `useFieldOptions` are unchanged.

```tsx
import { createEffectOptionSource, withOptionSources } from '@formbraid/react';
import { decodeSearchInputs, decodeResolveInputs, searchParties, findParty } from './party-provider';

const PartyOptions = createEffectOptionSource({
    list: {
        input: decodeSearchInputs,
        load: ({ organizationId, query }) => searchParties({ organizationId, query }),
    },
    resolve: {
        input: decodeResolveInputs,
        load: ({ organizationId }, selectedValue) => findParty({ organizationId, id: selectedValue }),
    },
});

const descriptor = withOptionSources(generatedDescriptor, {
    'PartyRequest:party_id': PartyOptions,
});
```

The imported functions are application-owned. Each `input` receives `readonly ResolvedOptionInput[]` and returns typed loader arguments, or `undefined` when its dependencies are not ready. Decode unknown values with Effect Schema; a thrown decoding error becomes an `error` state. Listing and resolution have separate input contracts, and the selected ID is supplied independently to the resolver.

`list.load` returns `Effect<readonly Option[], E, R>`; an empty array is completed empty data. The optional `resolve.load` returns `Effect<Option | null, E, R>`; `null` or an omitted resolver means `unavailable`, without changing the field's ID. Disabled or unready operations report `idle`. Failures and defects report `error` with the underlying error, not a rejected UI task.

Loaders run in a scope per operation. Input changes and unmounting abort the old execution and release scoped resources; late results cannot reach the replacement. No loader runs during SSR, and StrictMode cleanup is supported. Effects requiring application services must supply `run: runtime.runPromise` (or another core `EffectRunner`); service-free loaders use the default runner. The adapter owns each request's scope, not the application's runtime. Runtime/authorization identity changes must replace the binding/context just as with other adapters.

This helper adds no cache, retry policy, debounce, subscriptions, or HTTP endpoint convention. Use existing provider components for live subscriptions and provider hooks, and decode network responses inside the application's loader.

See the [Formbraid documentation](https://docs.nickwelsh.me/formbraid/) and [source repository](https://github.com/nickwelsh/formbraid).
