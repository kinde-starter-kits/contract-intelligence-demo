/// <reference types="vite/client" />
import {test} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import agentAuth from '@kinde-oss/kinde-convex-agent-auth/test';

// Glob of the app's Convex modules, handed to convex-test so it can run them.
// Lives in a `.test.ts` file so Convex excludes it from the deploy bundle
// (convex-test and `import.meta.glob` are test-only).
const modules = import.meta.glob('./**/*.*s');

/**
 * Build a convex-test instance for this app with the agent-auth component
 * registered, so tests that touch the component work too. Phase 1 tests only
 * exercise the app's own tables, but registering the component keeps the
 * mounted config honest.
 */
export function initConvexTest() {
  const t = convexTest(schema, modules);
  agentAuth.register(t);
  return t;
}

test('setup: convex-test instance builds with the component registered', () => {
  initConvexTest();
});
