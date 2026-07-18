/**
 * Deterministic contract clause chunker. No LLM, no randomness: the same input
 * text always produces exactly the same clauses. Splitting rule, in order:
 *
 *   1. If the text contains clause headings — a line that begins with a numbered
 *      marker (`1.`, `2)`, `1.2.`, `3.1.4)`) or a keyword marker (`Section 4`,
 *      `Clause 2`, `Article IV`) — each clause runs from one heading line up to
 *      (but not including) the next heading line. Any text before the first
 *      heading becomes a leading clause of its own.
 *   2. Otherwise, split on blank-line boundaries: each paragraph is a clause.
 *
 * Each clause is whitespace-trimmed and runs of 3+ blank lines inside a clause
 * are collapsed to one blank line. Empty clauses are dropped. Clauses are
 * re-indexed from 0 in document order.
 */

export interface Clause {
  index: number;
  text: string;
}

// A line that starts a new clause: a numbered marker or a keyword marker.
// The number must be at the START of the line, so a mid-sentence decimal like
// "1.5 million" is never mistaken for a heading; the trailing `.`/`)` is
// optional so both "1.1 Scope" and "1.1. Scope" are recognized.
const NUMBERED_HEADING = /^\s*\d+(\.\d+)*[.)]?\s+\S/;
const KEYWORD_HEADING = /^\s*(section|clause|article)\s+[0-9ivxlcdm]+\b/i;

function isHeadingLine(line: string): boolean {
  return NUMBERED_HEADING.test(line) || KEYWORD_HEADING.test(line);
}

/** Trim a clause and collapse 3+ consecutive newlines down to a single blank line. */
function normalizeClause(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function chunkContract(input: string): Clause[] {
  // Normalize line endings so \r\n and \r behave identically to \n.
  const text = input.replace(/\r\n?/g, '\n');

  if (text.trim() === '') {
    return [];
  }

  const lines = text.split('\n');
  const headingLineNumbers = lines
    .map((line, i) => (isHeadingLine(line) ? i : -1))
    .filter((i) => i !== -1);

  let rawClauses: string[];

  if (headingLineNumbers.length > 0) {
    rawClauses = [];
    // Any preamble before the first heading is its own clause.
    const firstHeading = headingLineNumbers[0];
    if (firstHeading > 0) {
      rawClauses.push(lines.slice(0, firstHeading).join('\n'));
    }
    // Each heading starts a clause that runs to the next heading.
    for (let h = 0; h < headingLineNumbers.length; h++) {
      const start = headingLineNumbers[h];
      const end = headingLineNumbers[h + 1] ?? lines.length;
      rawClauses.push(lines.slice(start, end).join('\n'));
    }
  } else {
    // No headings: split into paragraphs on blank-line boundaries.
    rawClauses = text.split(/\n\s*\n+/);
  }

  return rawClauses
    .map(normalizeClause)
    .filter((t) => t !== '')
    .map((t, index) => ({index, text: t}));
}
