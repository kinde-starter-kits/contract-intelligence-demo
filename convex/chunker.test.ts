import {describe, test, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {chunkContract} from './chunker';

describe('chunkContract — deterministic clause splitting', () => {
  test('empty input yields no clauses', () => {
    expect(chunkContract('')).toEqual([]);
  });

  test('whitespace-only input yields no clauses', () => {
    expect(chunkContract('   \n\n  \t \n')).toEqual([]);
  });

  test('single unnumbered clause yields exactly one clause', () => {
    const result = chunkContract('This is the only clause in the document.');
    expect(result).toEqual([
      {index: 0, text: 'This is the only clause in the document.'}
    ]);
  });

  test('numbered headings each start a clause, in order', () => {
    const text = [
      '1. Term. Twelve months.',
      '2. Fees. Net thirty.',
      '3. Termination. Thirty days notice.'
    ].join('\n\n');
    const result = chunkContract(text);
    expect(result.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(result[0].text).toBe('1. Term. Twelve months.');
    expect(result[1].text).toBe('2. Fees. Net thirty.');
    expect(result[2].text).toBe('3. Termination. Thirty days notice.');
  });

  test('preamble before the first heading becomes its own clause', () => {
    const text = [
      'MASTER SERVICES AGREEMENT',
      'This agreement is between the parties.',
      '',
      '1. Term. Twelve months.',
      '2. Fees. Net thirty.'
    ].join('\n');
    const result = chunkContract(text);
    expect(result).toHaveLength(3);
    expect(result[0].text).toContain('MASTER SERVICES AGREEMENT');
    expect(result[1].text).toBe('1. Term. Twelve months.');
    expect(result[2].text).toBe('2. Fees. Net thirty.');
  });

  test('sub-numbered headings (1.1, 1.2.3) are recognized', () => {
    const text = [
      '1. Scope.',
      '1.1 Included services.',
      '1.2.3) Edge case.'
    ].join('\n');
    const result = chunkContract(text);
    expect(result).toHaveLength(3);
    expect(result[1].text).toBe('1.1 Included services.');
    expect(result[2].text).toBe('1.2.3) Edge case.');
  });

  test('keyword headings (Section / Clause / Article) start clauses', () => {
    const text = [
      'Section 1. Definitions apply as follows.',
      'Article IV. Governing law is Delaware.',
      'Clause 3 Remedies are cumulative.'
    ].join('\n');
    const result = chunkContract(text);
    expect(result).toHaveLength(3);
    expect(result[0].text).toContain('Definitions');
    expect(result[1].text).toContain('Governing law');
    expect(result[2].text).toContain('Remedies');
  });

  test('a decimal mid-sentence (1.5 million) is not treated as a heading', () => {
    const text = 'The cap is 1.5 million dollars in aggregate liability.';
    const result = chunkContract(text);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(text);
  });

  test('unnumbered paragraphs split on blank lines', () => {
    const text = 'First paragraph clause.\n\nSecond paragraph clause.';
    const result = chunkContract(text);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('First paragraph clause.');
    expect(result[1].text).toBe('Second paragraph clause.');
  });

  test('CRLF and lone CR line endings behave like LF', () => {
    const lf = chunkContract('1. Alpha.\n\n2. Beta.');
    const crlf = chunkContract('1. Alpha.\r\n\r\n2. Beta.');
    const cr = chunkContract('1. Alpha.\r\r2. Beta.');
    expect(crlf).toEqual(lf);
    expect(cr).toEqual(lf);
  });

  test('weird whitespace: leading/trailing and extra blank lines are normalized', () => {
    const text = '\n\n\n   1. Padded clause.   \n\n\n\n2. Next clause.\n\n\n';
    const result = chunkContract(text);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('1. Padded clause.');
    expect(result[1].text).toBe('2. Next clause.');
  });

  test('is deterministic — same input produces identical output twice', () => {
    const text = readFileSync(
      join(__dirname, '..', 'fixtures', 'acme-msa.txt'),
      'utf-8'
    );
    const a = chunkContract(text);
    const b = chunkContract(text);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('sample MSA splits into its 13 numbered clauses plus preamble', () => {
    const text = readFileSync(
      join(__dirname, '..', 'fixtures', 'acme-msa.txt'),
      'utf-8'
    );
    const result = chunkContract(text);
    // Title/preamble block + clauses 1..13.
    expect(result).toHaveLength(14);
    expect(result[0].text).toContain('MASTER SERVICES AGREEMENT');
    expect(result[1].text.startsWith('1. Term and Automatic Renewal.')).toBe(
      true
    );
    expect(
      result[13].text.startsWith('13. Notices and Entire Agreement.')
    ).toBe(true);
  });
});
