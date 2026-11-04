import { defineConfig } from '@formbraid/react';
import { fieldGroups } from './address-group.js';
import { fieldComponents } from './field-components.js';
import { formComponents } from './form-components.js';

const formbraid = defineConfig({ components: fieldComponents, formComponents, groups: fieldGroups });

export default formbraid;
export const { Form, useForm } = formbraid;
