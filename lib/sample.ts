/**
 * The one canonical title for the seeded demo sample contract. Both the reset
 * script (`scripts/reset-demo.ts`) and the "Load the sample" route
 * (`app/api/sample/route.ts`) key off this exact title so an org never holds
 * more than one sample: the route reuses an existing match instead of inserting
 * a fresh copy, and the reset deletes-all-then-seeds-one under the same name.
 */
export const SAMPLE_CONTRACT_TITLE =
  'Meridian Cloud Services — Master Services Agreement';
