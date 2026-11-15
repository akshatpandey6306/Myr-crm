'use client';

import { useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import { downloadCsv, parseCsv } from '../../../lib/csv';
import styles from './LeadCsvImport.module.css';

type Field = 'name' | 'company' | 'source' | 'status';
type LeadRow = { name: string; company: string; source?: string; status?: string };
type PreviewRow = LeadRow & { row: number; errors: string[] };
type Props = { onImported: (count: number) => void; compact?: boolean };
const fields: Field[] = ['name', 'company', 'source', 'status'];
const requiredFields: Field[] = ['name', 'company'];
const maxFileSize = 5 * 1024 * 1024;
const maxImportRequestBytes = 80 * 1024;
const template = [
  ['name', 'company', 'source', 'status'],
  ['Olivia Rhye', 'Northstar Labs', 'website', 'new'],
];

function message(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'The request could not be completed.';
  const result = payload as { error?: { message?: unknown }; message?: unknown };
  const value = result.error?.message ?? result.message;
  return typeof value === 'string' ? value : 'The request could not be completed.';
}

function defaultColumn(headers: string[], field: Field) {
  const aliases: Record<Field, string[]> = {
    name: ['name', 'lead name', 'contact name'],
    company: ['company', 'company name', 'organization'],
    source: ['source', 'lead source'],
    status: ['status', 'lead status'],
  };
  return String(headers.findIndex((header) => aliases[field].includes(header.trim().toLowerCase())));
}

export default function LeadCsvImport({ onImported, compact = false }: Props) {
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [shapeErrors, setShapeErrors] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<Field, string>>({ name: '-1', company: '-1', source: '-1', status: '-1' });
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [canImport, setCanImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function reset() {
    setFileName('');
    setHeaders([]);
    setRows([]);
    setShapeErrors([]);
    setMapping({ name: '-1', company: '-1', source: '-1', status: '-1' });
    setPreview([]);
    setCanImport(false);
    setError('');
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setNotice('');
    setError('');
    setPreview([]);
    setCanImport(false);
    setFileName(file.name);
    if (file.size > maxFileSize) {
      setHeaders([]);
      setRows([]);
      setError('CSV files must be 5 MB or smaller.');
      return;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const [headerRow, ...dataRows] = parseCsv(text);
      if (!headerRow || dataRows.length === 0) throw new Error('Choose a non-empty CSV with a header and at least one lead.');
      if (dataRows.length > 500) throw new Error('Import no more than 500 leads at a time.');
      const normalizedHeaders = headerRow.map((header) => header.trim());
      if (normalizedHeaders.some((header) => !header)) throw new Error('Every CSV column must have a header.');
      if (new Set(normalizedHeaders.map((header) => header.toLowerCase())).size !== normalizedHeaders.length) {
        throw new Error('CSV column headers must be unique.');
      }
      const mappedHeaders = normalizedHeaders.map((header) => header.toLowerCase());
      setHeaders(normalizedHeaders);
      setRows(dataRows);
      setShapeErrors(dataRows.map((row) => row.length === headerRow.length ? '' : 'CSV row has a different number of columns than the header.'));
      setMapping({
        name: defaultColumn(mappedHeaders, 'name'),
        company: defaultColumn(mappedHeaders, 'company'),
        source: defaultColumn(mappedHeaders, 'source'),
        status: defaultColumn(mappedHeaders, 'status'),
      });
    } catch (caught) {
      setHeaders([]);
      setRows([]);
      setError(caught instanceof Error ? caught.message : 'Could not read this CSV file as UTF-8.');
    }
  }

  function mappedRows(): LeadRow[] {
    return rows.map((row) => {
      const valueFor = (field: Field) => {
        const index = Number(mapping[field]);
        return index >= 0 ? (row[index] ?? '').trim() : '';
      };
      return {
        name: valueFor('name'),
        company: valueFor('company'),
        ...(mapping.source !== '-1' ? { source: valueFor('source').toLowerCase() } : {}),
        ...(mapping.status !== '-1' ? { status: valueFor('status').toLowerCase() } : {}),
      };
    });
  }

  async function validateRows() {
    setBusy(true);
    setError('');
    setNotice('');
    setPreview([]);
    setCanImport(false);
    try {
      const requestBody = JSON.stringify({ rows: mappedRows() });
      if (new TextEncoder().encode(requestBody).byteLength > maxImportRequestBytes) {
        throw new Error('Import request is too large. Split this file into smaller batches.');
      }
      const response = await crmApiFetch('/leads/import/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      const validated = payload.data.rows as PreviewRow[];
      const merged = validated.map((row, index) => ({
        ...row,
        errors: [...row.errors, ...(shapeErrors[index] ? [shapeErrors[index]!] : [])],
      }));
      setPreview(merged);
      setCanImport(Boolean(payload.data.canImport) && merged.every(({ errors }) => errors.length === 0));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not validate this lead file.');
    } finally {
      setBusy(false);
    }
  }

  async function importRows() {
    const requestBody = JSON.stringify({ rows: mappedRows() });
    if (new TextEncoder().encode(requestBody).byteLength > maxImportRequestBytes) {
      setError('Import request is too large. Split this file into smaller batches.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await crmApiFetch('/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      const count = Number(payload.data?.createdCount) || 0;
      setNotice(`${count} leads were imported.`);
      reset();
      onImported(count);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import leads. No leads were imported.');
      setPreview([]);
      setCanImport(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={compact ? styles.compact : styles.root} aria-label="Import leads from CSV">
      {!compact && <div className={styles.heading}><div><strong>Import leads from CSV</strong><p>Preview and fix every row before importing. Existing leads are never overwritten.</p></div></div>}
      <div className={styles.actions}>
        <button className="button button-secondary" type="button" onClick={() => downloadCsv('lead-template.csv', template[0]!, [template[1]!])}>Download CSV template</button>
        <label className="button button-secondary">Choose lead CSV<input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={(event) => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
        {fileName && <span className={styles.filename}>{fileName}</span>}
      </div>
      {headers.length > 0 && <>
        <div className={styles.mapping}>
          <strong>Map CSV columns</strong>
          <div className={styles.mappingFields}>
            {fields.map((field) => <label key={field}>{field === 'name' ? 'Lead name' : field === 'company' ? 'Company' : field === 'source' ? 'Source (optional)' : 'Status (optional)'}
              <select value={mapping[field]} onChange={(event) => { setMapping((current) => ({ ...current, [field]: event.target.value })); setPreview([]); setCanImport(false); }}>
                <option value="-1">Not mapped</option>
                {headers.map((header, index) => <option key={index} value={String(index)}>{header}</option>)}
              </select>
            </label>)}
          </div>
          <p>Sources: website, referral, linkedin, other. Statuses: new, contacted, qualified, disqualified. Unmapped source/status default to website/new.</p>
          <button className="button button-secondary" type="button" disabled={busy || requiredFields.some((field) => mapping[field] === '-1')} onClick={() => void validateRows()}>{busy ? 'Validating…' : 'Preview and validate import'}</button>
        </div>
        {preview.length > 0 && <div className={styles.preview}>
          <strong>{preview.filter(({ errors }) => errors.length === 0).length} valid of {preview.length} rows</strong>
          <div className={styles.tableWrap}><table><thead><tr><th>ROW</th><th>LEAD</th><th>COMPANY</th><th>SOURCE</th><th>STATUS</th><th>VALIDATION</th></tr></thead><tbody>
            {preview.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.name || '—'}</td><td>{row.company || '—'}</td><td>{row.source || 'website'}</td><td>{row.status || 'new'}</td><td>{row.errors.length ? row.errors.join(' ') : 'Ready to import'}</td></tr>)}
          </tbody></table></div>
          <button className="button button-primary" type="button" disabled={busy || !canImport} onClick={() => void importRows()}>{busy ? 'Importing…' : `Import ${preview.length} leads`}</button>
        </div>}
      </>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {fileName && <button className={styles.reset} type="button" disabled={busy} onClick={reset}>Clear file</button>}
    </section>
  );
}
