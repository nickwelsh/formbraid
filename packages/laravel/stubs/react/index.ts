import { defineConfig } from '@formbraid/react';
import { TextField, NumberField, CheckboxField, DateField, SelectField, FileField } from './fields.js';
import { SubmitButton } from './form-components.js';

export const { Form, useForm } = defineConfig({
    components: { TextField, NumberField, CheckboxField, DateField, SelectField, FileField },
    formComponents: { SubmitButton },
    submitComponent: 'SubmitButton',
});
