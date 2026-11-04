import { useFieldContext } from '@formbraid/react';
import type { FieldProps } from '@formbraid/react';

export function TextField({
    label,
    helpText,
    constraints,
    type = 'text',
}: FieldProps<string | null> & { readonly type?: 'text' | 'email' | 'url' }) {
    const field = useFieldContext<string | null>();
    return (
        <label>
            {label}
            <input
                name={field.name}
                type={type}
                value={field.value ?? ''}
                required={constraints.required}
                minLength={constraints.minLength}
                maxLength={constraints.maxLength}
                onChange={(event) => field.setValue(event.target.value)}
                onBlur={() => field.touch()}
            />
            {helpText}
            <Errors errors={field.errors} />
        </label>
    );
}

export function NumberField({ label, helpText, constraints }: FieldProps<number | null>) {
    const field = useFieldContext<number | null>();
    return (
        <label>
            {label}
            <input
                name={field.name}
                type="number"
                value={field.value ?? ''}
                required={constraints.required}
                min={constraints.min}
                max={constraints.max}
                onChange={(event) => field.setValue(event.target.value === '' ? null : event.target.valueAsNumber)}
                onBlur={() => field.touch()}
            />
            {helpText}
            <Errors errors={field.errors} />
        </label>
    );
}

export function CheckboxField({ label, helpText, constraints }: FieldProps<boolean>) {
    const field = useFieldContext<boolean>();
    return (
        <label>
            <input
                name={field.name}
                type="checkbox"
                checked={field.value}
                aria-required={constraints.required}
                onChange={(event) => field.setValue(event.target.checked)}
                onBlur={() => field.touch()}
            />
            {label}
            {helpText}
            <Errors errors={field.errors} />
        </label>
    );
}

export function DateField({ label, helpText, constraints }: FieldProps<string | null>) {
    const field = useFieldContext<string | null>();
    return (
        <label>
            {label}
            <input
                name={field.name}
                type="date"
                value={field.value ?? ''}
                required={constraints.required}
                onChange={(event) => field.setValue(event.target.value)}
                onBlur={() => field.touch()}
            />
            {helpText}
            <Errors errors={field.errors} />
        </label>
    );
}

export function SelectField({ label, helpText, constraints }: FieldProps<string | number | null>) {
    const field = useFieldContext<string | number | null>();
    return (
        <label>
            {label}
            <select
                name={field.name}
                value={field.value ?? ''}
                required={constraints.required}
                onChange={(event) =>
                    field.setValue(constraints.options?.find((option) => String(option) === event.target.value) ?? '')
                }
                onBlur={() => field.touch()}
            >
                <option value="">Choose…</option>
                {constraints.options?.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
            {helpText}
            <Errors errors={field.errors} />
        </label>
    );
}

export function FileField({ label, helpText, constraints }: FieldProps<File | null>) {
    const field = useFieldContext<File | null>();
    return (
        <label>
            {label}
            <input
                name={field.name}
                type="file"
                required={constraints.required}
                onChange={(event) => field.setValue(event.target.files?.[0] ?? null)}
                onBlur={() => field.touch()}
            />
            {helpText}
            <Errors errors={field.errors} />
        </label>
    );
}

function Errors({ errors }: { readonly errors: ReadonlyArray<string> }) {
    return errors.length === 0 ? null : <span role="alert">{errors.join(' ')}</span>;
}
