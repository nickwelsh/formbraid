import { describe, expect, it, vi } from 'vite-plus/test';
import { Effect, Schema } from 'effect';
import {
    isJsonValue,
    parseExtraction,
    parseExtractionEffect,
    parseJsonValueEffect,
    FormMetadataSchema,
} from './parse.js';

vi.setConfig({ testTimeout: 10_000 });

const extraction = {
    version: 1,
    forms: [
        {
            id: 'Profile',
            defaultValues: { name: '', preferences: { enabled: false } },
            fields: {
                name: {
                    name: 'name',
                    type: 'string',
                    component: 'TextField',
                    label: 'Name',
                    nullable: false,
                    props: {},
                    constraints: { required: true },
                    serverRules: [],
                },
            },
            groups: {},
        },
    ],
    diagnostics: [],
} as const;

describe('native metadata decoding', () => {
    it('decodes portable form metadata without accepting executable descriptor data', () => {
        expect.hasAssertions();
        const [metadata] = extraction.forms;
        const decode = Schema.decodeUnknownEffect(FormMetadataSchema, { onExcessProperty: 'error' });
        expect(Effect.runSync(decode(metadata))).toStrictEqual(metadata);
        for (const invalid of [
            { ...metadata, defaultValues: [] },
            { ...metadata, schema: {} },
            { ...metadata, submission: { submit: () => ({ status: 'success' }) } },
            { version: 1, definition: metadata, submission: { submit: () => ({ status: 'success' }) } },
        ]) {
            const error = Effect.runSync(Effect.flip(decode(invalid)));
            expect(Schema.isSchemaError(error)).toBe(true);
        }
    });

    it('shares the native decoder at synchronous and Effect boundaries', () => {
        expect.hasAssertions();
        const json = JSON.stringify(extraction);
        expect(parseExtraction(json)).toStrictEqual(extraction);
        expect(Effect.runSync(parseExtractionEffect(json))).toStrictEqual(extraction);
    });

    it('rejects malformed, unsupported and excess metadata through typed schema failures', () => {
        expect.hasAssertions();
        const [form] = extraction.forms;
        const invalid = [
            '{',
            JSON.stringify({ ...extraction, version: 2 }),
            JSON.stringify({ ...extraction, actions: [] }),
            JSON.stringify({ ...extraction, forms: [{ ...form, target: { url: '/', method: 'post' } }] }),
            JSON.stringify({
                ...extraction,
                forms: [{ ...form, fields: { name: { ...form.fields.name, constraints: { required: 'yes' } } } }],
            }),
        ];
        for (const json of invalid) {
            const error = Effect.runSync(Effect.flip(parseExtractionEffect(json)));
            expect(Schema.isSchemaError(error)).toBe(true);
        }
    });

    it('accepts portable JSON while rejecting nonfinite and platform values', () => {
        expect.hasAssertions();
        expect(Effect.runSync(parseJsonValueEffect('{"nested":[null,false,42,"value"]}'))).toStrictEqual({
            nested: [null, false, 42, 'value'],
        });
        expect([Infinity, Number.NaN, new Date(), undefined].map((value) => isJsonValue(value))).toStrictEqual([
            false,
            false,
            false,
            false,
        ]);
        const error = Effect.runSync(Effect.flip(parseJsonValueEffect('1e999')));
        expect(Schema.isSchemaError(error)).toBe(true);
    });
});
