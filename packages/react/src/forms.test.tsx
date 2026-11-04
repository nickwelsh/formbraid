/* oxlint-disable eslint/new-cap -- Effect Schema uses capitalized functional schema constructors. */
import { vi, afterEach, describe, expect, it } from 'vite-plus/test';

import { definitionSchema } from '@formbraid/core';
import type { EffectRunner, SubmissionCallback, SubmissionCallbackContext, SubmissionResult } from '@formbraid/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createFormbraid } from './create-formbraid.js';
import { fieldComponents } from '@formbraid/example/field-components.js';
import { Effect, Schema, SchemaGetter } from 'effect';
import { formComponents } from '@formbraid/example/form-components.js';
import { fieldGroups } from '@formbraid/example/address-group.js';
import { UpdateProfileRequest } from './__fixtures__/profile.js';
import type { UpdateProfileRequestValues } from './__fixtures__/profile.js';

vi.setConfig({ testTimeout: 10_000 });

const validValues: UpdateProfileRequestValues = {
    name: 'Nick',
    email: 'nick@example.com',
    newsletter: false,
    company: null,
    address_line_1: '123 Main Street',
    address_line_2: null,
    city: 'Boston',
    state: 'MA',
    zip: '02110',
};

const { Form } = createFormbraid({ fieldComponents, formComponents, fieldGroups });
const descriptor = {
    version: 1 as const,
    definition: UpdateProfileRequest,
    submission: { submit: (): SubmissionResult => ({ status: 'success' }) },
};

describe('bound React forms', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders grouped fields once and updates every mapped address value on selection', async () => {
        expect.hasAssertions();
        const signalStates: Array<boolean> = [];
        const submit = vi.fn<SubmissionCallback<UpdateProfileRequestValues>>((_values, context) => {
            signalStates.push(context.signal.aborted);
            return { status: 'success' };
        });
        render(
            <Form
                form={descriptor}
                submit={submit}
                defaultValues={{ ...validValues, address_line_1: '', city: '', state: '', zip: '' }}
            />,
        );
        expect(screen.queryByLabelText('City')).toBeNull();
        const user = userEvent.setup();
        await user.type(screen.getByLabelText('Find Address'), 'Main');
        await user.click(screen.getByRole('button', { name: '123 Main Street, Boston, MA 02110' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(submit).toHaveBeenCalledTimes(1);
        });
        expect(submit.mock.calls[0]?.[0]).toStrictEqual(validValues);
        expect(signalStates).toStrictEqual([false]);
    });

    it('validates only on submit, including edits after a failed submission', async () => {
        expect.hasAssertions();
        const validate = vi.fn<() => void>();
        const run: EffectRunner = async (effect, options) => {
            validate();
            return await Effect.runPromise(effect, options);
        };
        const definition = { ...UpdateProfileRequest, schema: definitionSchema(UpdateProfileRequest) };
        const submit = vi.fn<SubmissionCallback<UpdateProfileRequestValues>>().mockReturnValue({ status: 'success' });
        render(<Form form={definition} submit={submit} defaultValues={validValues} run={run} />);
        const user = userEvent.setup();
        const email = screen.getByLabelText('Email *');
        await user.clear(email);
        await user.type(email, 'invalid');
        await user.tab();

        expect(validate).not.toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('Email must be a valid email address.');
        });
        const callsAfterSubmit = validate.mock.calls.length;
        await user.type(email, '-still-invalid');
        await user.tab();
        expect(validate).toHaveBeenCalledTimes(callsAfterSubmit);

        await user.clear(email);
        await user.type(email, 'nick@example.com');
        await user.tab();
        await user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(submit).toHaveBeenCalledTimes(1);
        });
    });

    it('reactively changes required metadata and blocks an incomplete conditional field', async () => {
        expect.hasAssertions();
        const submit = vi.fn<SubmissionCallback<UpdateProfileRequestValues>>().mockReturnValue({ status: 'success' });
        render(<Form form={descriptor} submit={submit} defaultValues={validValues} />);
        const user = userEvent.setup();
        const company = screen.getByLabelText('Company');
        expect(company.getAttribute('aria-required')).toBe('false');
        await user.click(screen.getByRole('checkbox'));
        expect(company.getAttribute('aria-required')).toBe('true');
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(submit).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toContain('Company is required');
    });

    it('preserves edits and focus when definitions and default props are recreated', async () => {
        expect.hasAssertions();
        const view = render(<Form form={descriptor} defaultValues={validValues} />);
        const user = userEvent.setup();
        const input = screen.getByLabelText('Name *');
        await user.clear(input);
        await user.type(input, 'Edited');
        view.rerender(<Form form={{ ...descriptor }} defaultValues={{ ...validValues, name: 'Replacement' }} />);
        expect(screen.getByLabelText('Name *')).toBe(input);
        expect(input).toBe(document.activeElement);
        expect(input.getAttribute('value')).toBe('Edited');
    });

    it('custom layouts render only explicitly placed fields and expose registered form components', () => {
        expect.hasAssertions();
        render(
            <Form form={descriptor}>
                {({ fields, components }) => (
                    <>
                        <fields.email label="Contact Email" />
                        <components.SubmitButton label="Update" />
                    </>
                )}
            </Form>,
        );
        expect(screen.getByLabelText('Contact Email *')).toBeDefined();
        expect(screen.queryByLabelText('Name *')).toBeNull();
        expect(screen.queryByLabelText('Find Address')).toBeNull();
        expect(screen.getByRole('button', { name: 'Update' })).toBeDefined();
    });

    it('keeps separate mounted instances isolated and maps server errors into group fields', async () => {
        expect.hasAssertions();
        const submit = vi
            .fn<SubmissionCallback<UpdateProfileRequestValues>>()
            .mockReturnValue({ status: 'invalid', errors: { city: 'Choose a supported city.' } });
        const view = render(
            <>
                <Form aria-label="First" form={descriptor} submit={submit} defaultValues={validValues} />
                <Form aria-label="Second" form={descriptor} defaultValues={{ ...validValues, name: 'Other' }} />
            </>,
        );
        const first = within(view.getByRole('form', { name: 'First' }));
        const second = within(view.getByRole('form', { name: 'Second' }));
        const user = userEvent.setup();
        await user.type(first.getByLabelText('Name *'), ' Edited');
        expect(second.getByLabelText('Name *').getAttribute('value')).toBe('Other');
        await user.click(first.getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(first.getByRole('alert').textContent).toBe('Choose a supported city.');
        });
        expect(second.queryByRole('alert')).toBeNull();
    });

    it('submits transformed schema output rather than the draft', async () => {
        expect.hasAssertions();
        const submit = vi.fn<SubmissionCallback<{ email: string }>>().mockReturnValue({ status: 'success' });
        const definition = {
            ...UpdateProfileRequest,
            schema: definitionSchema(UpdateProfileRequest).pipe(
                Schema.decodeTo(Schema.Struct({ email: Schema.String }), {
                    decode: SchemaGetter.transform(() => ({ email: 'parsed@example.com' })),
                    encode: SchemaGetter.transform(() => validValues),
                }),
            ),
        };
        render(<Form form={definition} defaultValues={validValues} submit={submit} />);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(submit).toHaveBeenCalledTimes(1);
        });
        expect(submit.mock.calls[0]?.[0]).toStrictEqual({ email: 'parsed@example.com' });
    });

    it('selects per-form callbacks for the same schema and awaits non-HTTP server acceptance', async () => {
        expect.hasAssertions();
        const pending: { complete?: (result: SubmissionResult) => void } = {};
        const webSubmit = vi
            .fn<SubmissionCallback<UpdateProfileRequestValues>>()
            .mockReturnValue({ status: 'success' });
        const mutationSubmit = vi.fn<SubmissionCallback<UpdateProfileRequestValues>>(
            async () =>
                await new Promise<SubmissionResult>((resolve) => {
                    pending.complete = resolve;
                }),
        );
        const local = createFormbraid({
            fieldComponents,
            formComponents,
            fieldGroups,
        });
        const onResult = vi.fn<(result: SubmissionResult) => void>();
        const bound = { ...descriptor, submission: { submit: mutationSubmit } };
        const view = render(
            <>
                <local.Form
                    aria-label="Web"
                    form={{ ...descriptor, submission: { submit: webSubmit } }}
                    defaultValues={validValues}
                />
                <local.Form aria-label="Mutation" form={bound} defaultValues={validValues} onResult={onResult} />
            </>,
        );
        await userEvent
            .setup()
            .click(within(view.getByRole('form', { name: 'Mutation' })).getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(mutationSubmit).toHaveBeenCalledTimes(1);
        });
        expect(webSubmit).not.toHaveBeenCalled();
        expect(mutationSubmit.mock.calls[0]?.[0]).toStrictEqual(validValues);
        expect(screen.getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true);
        expect(onResult).not.toHaveBeenCalled();
        pending.complete?.({ status: 'invalid', errors: { email: 'Rejected by the server.' } });
        await waitFor(() => {
            expect(onResult).toHaveBeenCalledTimes(1);
        });
        expect(screen.getByRole('alert').textContent).toBe('Rejected by the server.');
    });

    it('reports a missing submit callback as a defect', async () => {
        expect.hasAssertions();
        const onResult = vi.fn<(result: SubmissionResult) => void>();
        render(<Form form={UpdateProfileRequest} defaultValues={validValues} onResult={onResult} />);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(onResult).toHaveBeenCalledTimes(1);
        });
        expect(onResult.mock.calls[0]?.[0]).toMatchObject({ status: 'defect' });
    });

    it('keeps submission state active and aborts the pending callback when unmounted', async () => {
        expect.hasAssertions();
        const pending: { context?: SubmissionCallbackContext; complete?: (result: SubmissionResult) => void } = {};
        const submit: SubmissionCallback<UpdateProfileRequestValues> = async (_values, next) => {
            pending.context = next;
            return await new Promise<SubmissionResult>((resolve) => {
                pending.complete = resolve;
            });
        };
        const view = render(<Form form={descriptor} defaultValues={validValues} submit={submit} />);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true);
        });
        view.unmount();
        expect(pending.context?.signal.aborted).toBe(true);
        pending.complete?.({ status: 'cancelled' });
    });
});
