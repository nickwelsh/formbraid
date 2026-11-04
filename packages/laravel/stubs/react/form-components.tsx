import { useFormContext } from '@formbraid/react';

export function SubmitButton({ label = 'Submit' }: { readonly label?: string }) {
    const form = useFormContext();
    return (
        <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
                <button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Submitting…' : label}
                </button>
            )}
        </form.Subscribe>
    );
}
