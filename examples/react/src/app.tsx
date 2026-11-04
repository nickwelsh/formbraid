import type { SubmissionResult } from '@formbraid/core';
import { useEffect, useState } from 'react';
import { Form } from './forms.js';
import { update } from './generated/controllers/Example/Http/Controllers/ProfileController.js';
import { MassiveFormBenchmark } from './massive-form-benchmark.js';
import './style.css';

function ProfileExample() {
    const [submitted, setSubmitted] = useState(false);
    useEffect(() => {
        // A Laravel-rendered page already sets this cookie. The standalone Vite example requests it once.
        void fetch('/csrf-cookie', { credentials: 'same-origin' });
    }, []);
    function handleResult(result: SubmissionResult) {
        setSubmitted(result.status === 'success');
    }
    return (
        <main>
            <h1>Formbraid</h1>
            <p>Laravel rules, application fields, and one address input.</p>
            <Form form={update({ user: 42 })} onResult={handleResult}>
                {({ fields, components, groups }) => (
                    <>
                        <fields.name />
                        <fields.email />
                        <fields.newsletter />
                        <fields.company />
                        <groups.address />
                        <components.FormErrors />
                        <components.SubmitButton label="Save Profile" />
                    </>
                )}
            </Form>
            {submitted ? (
                <section>
                    <h2>Saved by Laravel</h2>
                    <output>The generated Fetch handler submitted the form with cookie-based CSRF protection.</output>
                </section>
            ) : null}
        </main>
    );
}

export function App() {
    return new URLSearchParams(globalThis.location.search).get('benchmark') === 'massive' ? (
        <MassiveFormBenchmark />
    ) : (
        <ProfileExample />
    );
}
