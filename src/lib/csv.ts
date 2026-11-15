export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  if (!text.trim()) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote && character !== ',' && character !== '\r' && character !== '\n') {
      throw new Error('CSV contains unexpected characters after a quoted value.');
    }
    if (character === '"' && field.length === 0 && !afterQuote) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
      afterQuote = false;
    } else if (character === '\r' || character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      afterQuote = false;
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else if (character === '"') {
      throw new Error('CSV contains a quote in an unquoted value.');
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('CSV contains an unclosed quoted value.');
  if (field.length > 0 || row.length > 0 || afterQuote || text.endsWith(',')) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function createCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const blob = new Blob([`\uFEFF${createCsv(headers, rows)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
