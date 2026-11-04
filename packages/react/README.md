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

See the [Formbraid documentation](https://docs.nickwelsh.me/formbraid/) and [source repository](https://github.com/nickwelsh/formbraid).
