import { describe, expect, it } from 'vitest';
import { createCsv, parseCsv } from './csv';

describe('CSV helpers', () => {
  it('parses quoted commas, escaped quotes, line endings, and UTF-8 BOMs', () => {
    expect(parseCsv('\uFEFFname,company\r\n"Alex, Jr.","North ""Star"""\r\n')).toEqual([
      ['name', 'company'],
      ['Alex, Jr.', 'North "Star"'],
    ]);
  });

  it('returns no rows for an empty file and rejects malformed quoting', () => {
    expect(parseCsv(' \r\n')).toEqual([]);
    expect(() => parseCsv('name,company\n"Alex')).toThrow('unclosed quoted value');
    expect(() => parseCsv('name,company\nAlex"')).toThrow('quote in an unquoted value');
  });

  it('quotes CSV values and neutralizes spreadsheet formulas', () => {
    expect(createCsv(['name', 'details'], [['=1+1', 'A "quote"']])).toBe(
      '"name","details"\r\n"\'=1+1","A ""quote"""',
    );
  });
});
