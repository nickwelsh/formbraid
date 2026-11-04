import type { FieldDefinition, FormDefinition, GroupDefinition } from './contracts.js';
import { pathSegments } from './paths.js';

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- The outer constraint permits explicitly chosen services while the inner schema generic infers them.
export function defineForm<TValues extends object, TOutput = TValues, TServices = unknown>() {
    return <
        const TFields extends Readonly<Record<string, FieldDefinition>>,
        const TGroups extends Readonly<Record<string, GroupDefinition>>,
        TSchemaServices extends TServices = never,
    >(
        definition: FormDefinition<TValues, TFields, TGroups, TOutput, TSchemaServices>,
    ): FormDefinition<TValues, TFields, TGroups, TOutput, TSchemaServices> => {
        const claimed = new Set<string>();
        for (const field of Object.values(definition.fields)) {
            pathSegments(field.name.replaceAll('.*', '.0'));
            if (field.options?.kind === 'source') {
                const location = `${definition.id}.${field.name}`;
                if (field.name.includes('*')) {
                    throw new Error(`${location}: wildcard-relative option sources are not supported.`);
                }
                if (field.options.resolveInputs.some((reference) => reference.kind === 'value')) {
                    throw new Error(`${location}: selected-ID resolution cannot depend on control-local value.`);
                }
                const dependencies = [...field.options.inputs, ...field.options.resolveInputs].filter(
                    (reference) => reference.kind === 'field',
                );
                for (const reference of dependencies) {
                    if (reference.path.includes('*')) {
                        throw new Error(
                            `${location}: wildcard-relative dependency ${reference.path} is not supported.`,
                        );
                    }
                    pathSegments(reference.path);
                }
            }
        }
        for (const [name, group] of Object.entries(definition.groups)) {
            for (const path of Object.values(group.fields)) {
                if (!Object.values(definition.fields).some((field) => field.name === path)) {
                    throw new Error(`Group ${name} references unknown field ${path}.`);
                }
                if (claimed.has(path)) {
                    throw new Error(`Field ${path} belongs to more than one group.`);
                }
                claimed.add(path);
            }
        }
        return definition;
    };
}

export function routeUrl(uri: string, parameters: Readonly<Record<string, string | number>>): string {
    const used = new Set<string>();
    const url = uri.replaceAll(
        /\{(?<name>\w+)(?<optional>\?)?\}/gu,
        (_, name: string, optional: string | undefined) => {
            used.add(name);
            const value = parameters[name];
            if (value === undefined) {
                if (optional !== undefined) {
                    return '';
                }
                throw new Error(`Missing route parameter: ${name}`);
            }
            return encodeURIComponent(String(value));
        },
    );
    for (const name of Object.keys(parameters)) {
        if (!used.has(name)) {
            throw new Error(`Unknown route parameter: ${name}`);
        }
    }
    return `/${url.replaceAll(/^\/+|\/+$/gu, '')}`;
}
