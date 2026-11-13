import { describe, expect, it } from 'vite-plus/test';

describe('test DOM HTML parser', () => {
    it('handles consecutive low surrogates without crashing', () => {
        expect.hasAssertions();
        const element = globalThis.document.createElement('div');
        expect(() => {
            element.innerHTML = '<a\uDC00\uDC00>text</a>';
        }).not.toThrow();
        expect(element.textContent).toBe('text');
    }, 1000);

    it('preserves valid surrogate pairs and escapes text on serialization', () => {
        expect.hasAssertions();
        const element = globalThis.document.createElement('div');
        element.innerHTML = '<p>\uD83D\uDE00 &lt;script&gt;</p>';
        expect(element.textContent).toBe('\uD83D\uDE00 <script>');
        expect(element.querySelector('script')).toBeNull();
        expect(element.innerHTML).toContain('&lt;script&gt;');
    }, 1000);
});
