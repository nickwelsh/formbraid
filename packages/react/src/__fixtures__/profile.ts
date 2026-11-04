import { defineForm } from '@formbraid/core';
import type { Constraints } from '@formbraid/core';

// Runtime tests own their metadata instead of depending on generated example files.
export interface UpdateProfileRequestValues {
    name: string;
    email: string;
    newsletter: boolean;
    company: string | null;
    address_line_1: string;
    address_line_2: string | null;
    city: string;
    state: string;
    zip: string;
}

function textField(name: string, label: string, constraints: Constraints = {}) {
    return {
        name,
        type: 'string' as const,
        component: 'TextField' as const,
        label,
        props: {},
        constraints,
        nullable: false,
        serverRules: [],
    };
}

export const UpdateProfileRequest = defineForm<UpdateProfileRequestValues>()({
    id: 'profile-test',
    defaultValues: {
        name: '',
        email: '',
        newsletter: false,
        company: null,
        address_line_1: '',
        address_line_2: null,
        city: '',
        state: '',
        zip: '',
    },
    fields: {
        name: textField('name', 'Name', { required: true, maxLength: 255 }),
        email: {
            ...textField('email', 'Email', { required: true, format: 'email' }),
            helpText: 'We use this to send profile updates.',
            props: { type: 'email' },
            serverRules: ['email'],
        },
        newsletter: {
            name: 'newsletter',
            type: 'boolean',
            component: 'CheckboxField',
            label: 'Newsletter',
            props: {},
            constraints: { required: true },
            nullable: false,
            serverRules: [],
        },
        company: {
            ...textField('company', 'Company', {
                required: false,
                requiredWhen: [{ field: 'newsletter', values: ['true'], operator: 'equals' }],
            }),
            nullable: true,
        },
        address_line_1: textField('address_line_1', 'Address Line 1', { required: true }),
        address_line_2: { ...textField('address_line_2', 'Address Line 2', { required: false }), nullable: true },
        city: textField('city', 'City', { required: true }),
        state: textField('state', 'State', { required: true, maxLength: 2 }),
        zip: textField('zip', 'Zip', { required: true, minLength: 5, maxLength: 10 }),
    },
    groups: {
        address: {
            component: 'AddressAutocomplete',
            label: 'Delivery Address',
            fields: {
                line1: 'address_line_1',
                line2: 'address_line_2',
                city: 'city',
                state: 'state',
                postalCode: 'zip',
            },
            props: {},
        },
    },
});
