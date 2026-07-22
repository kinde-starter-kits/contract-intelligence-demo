import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';

// convex-test runs Convex functions in a simulated environment. It needs the
// edge runtime and convex-test inlined so its `import.meta.glob` module map
// resolves against the test file's directory.
export default defineConfig({
  resolve: {
    // Match the app's `@/` path alias so app/lib modules can be unit-tested.
    alias: {'@': fileURLToPath(new URL('.', import.meta.url))}
  },
  test: {
    environment: 'edge-runtime',
    server: {
      deps: {
        inline: ['convex-test']
      }
    }
  }
});
