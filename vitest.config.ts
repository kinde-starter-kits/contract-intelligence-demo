import {defineConfig} from 'vitest/config';

// convex-test runs Convex functions in a simulated environment. It needs the
// edge runtime and convex-test inlined so its `import.meta.glob` module map
// resolves against the test file's directory.
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    server: {
      deps: {
        inline: ['convex-test']
      }
    }
  }
});
