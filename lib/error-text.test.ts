import {describe, test, expect} from 'vitest';
import {errorText} from './error-text';

describe('errorText — coerces any error shape to readable text', () => {
  test('passes a string through', () => {
    expect(errorText('boom')).toBe('boom');
  });

  test('the crashing shape {code, message} renders its message', () => {
    // This is the object that produced "Objects are not valid as a React child
    // (found: object with keys {code, message})".
    expect(errorText({code: 'llm_key_rejected', message: 'Key rejected'})).toBe(
      'Key rejected'
    );
  });

  test('a bare {code} falls back to the code string', () => {
    expect(errorText({code: 'byok_key_required'})).toBe('byok_key_required');
  });

  test('a FastAPI 422 array renders the joined messages', () => {
    expect(
      errorText([
        {loc: ['body', 'apiKey'], msg: 'field required', type: 'value_error'},
        {
          loc: ['body', 'contractId'],
          msg: 'field required',
          type: 'value_error'
        }
      ])
    ).toBe('field required; field required');
  });

  test('a nested {detail: {...}} is unwrapped', () => {
    expect(errorText({detail: {message: 'nested reason'}})).toBe(
      'nested reason'
    );
  });

  test('null/undefined/empty use the fallback', () => {
    expect(errorText(null, 'fallback')).toBe('fallback');
    expect(errorText(undefined, 'fallback')).toBe('fallback');
    expect(errorText({}, 'fallback')).toBe('fallback');
    expect(errorText('   ', 'fallback')).toBe('fallback');
  });

  test('an unrecognised object stringifies rather than crashing', () => {
    expect(errorText({weird: 1})).toBe('{"weird":1}');
  });

  test('always returns a string (never an object) for React safety', () => {
    for (const v of [{a: {b: {}}}, [], [null], 42, true, Symbol('x')]) {
      expect(typeof errorText(v as unknown)).toBe('string');
    }
  });
});
