'use client';

import { useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import { downloadCsv, parseCsv } from '../../../lib/csv';
import styles from '../leads/LeadCsvImport.module.css';

type Field = 'name' | 'email' | 'phone' | 'title' | 'company';
type ContactRow = { name: string; email: string; phone?: string; title?: string; company?: string };
type PreviewRow = ContactRow & { row: number; errors: string[] };
type Props = { onImported: (count: number) => void };
const fields: Field[] = ['name', 'email', 'phone', 'title', 'company'];
const requiredFields: Field[] = ['name', 'email'];
const template = [
  ['name', 'email', 'phone', 'title', 'company'],
  ['Olivia Rhye', 'olivia@northstar.example', '+1 415 555 0134', 'Operations Director', 'Northstar Labs'],
];

function message(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'The request could not be completed.';
  const result = payload as { error?: { message?: unknown }; message?: unknown };
  const value = result.error?.message ?? result.message;
  return typeof value === 'string' ? value : 'The request could not be completed.';
}

function defaultColumn(headers: string[], field: Field) {
  const aliases: Record<Field, string[]> = {
    name: ['name', 'contact name', 'customer name'],
    email: ['email', 'email address', 'customer email'],
    phone: ['phone', 'phone number', 'mobile'],
    title: ['title', 'job title', 'position'],
    company: ['company', 'company name', 'organization'],
  };
  return String(headers.findIndex((header) => aliases[field].includes(header.trim().toLowerCase())));
}

export default function ContactCsvImport({ onImported }: Props) {
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [shapeErrors, setShapeErrors] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<Field, string>>({ name: '-1', email: '-1', phone: '-1', title: '-1', company: '-1' });
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [canImport, setCanImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setFileName('');
    setHeaders([]);
    setRows([]);
    setShapeErrors([]);
    setMapping({ name: '-1', email: '-1', phone: '-1', title: '-1', company: '-1' });
    setPreview([]);
    setCanImport(false);
    setError('');
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setPreview([]);
    setCanImport(false);
    setFileName(file.name);
    if (file.size > 5 * 1024 * 1024) {
      setHeaders([]);
      setRows([]);
      setError('CSV files must be 5 MB or smaller.');
      return;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const [headerRow, ...dataRows] = parseCsv(text);
      if (!headerRow || dataRows.length === 0) throw new Error('Choose a non-empty CSV with a header and at least one contact.');
      if (dataRows.length > 500) throw new Error('Import no more than 500 contacts at a time.');
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
        email: defaultColumn(mappedHeaders, 'email'),
        phone: defaultColumn(mappedHeaders, 'phone'),
        title: defaultColumn(mappedHeaders, 'title'),
        company: defaultColumn(mappedHeaders, 'company'),
      });
    } catch (caught) {
      setHeaders([]);
      setRows([]);
      setError(caught instanceof Error ? caught.message : 'Could not read this CSV file as UTF-8.');
    }
  }

  function mappedRows(): ContactRow[] {
    return rows.map((row) => {
      const valueFor = (field: Field) => {
        const index = Number(mapping[field]);
        return index >= 0 ? (row[index] ?? '').trim() : '';
      };
      return {
        name: valueFor('name'),
        email: valueFor('email'),
        ...(mapping.phone !== '-1' ? { phone: valueFor('phone') } : {}),
        ...(mapping.title !== '-1' ? { title: valueFor('title') } : {}),
        ...(mapping.company !== '-1' ? { company: valueFor('company') } : {}),
      };
    });
  }

  async function send(path: '/contacts/import/validate' | '/contacts/import') {
    const body = JSON.stringify({ rows: mappedRows() });
    if (new TextEncoder().encode(body).byteLength > 80 * 1024) {
      throw new Error('Import request is too large. Split this file into smaller batches.');
    }
    const response = await crmApiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload));
    return payload;
  }

  async function validateRows() {
    setBusy(true);
    setError('');
    setPreview([]);
    setCanImport(false);
    try {
      const payload = await send('/contacts/import/validate');
      const validated = payload.data.rows as PreviewRow[];
      const merged = validated.map((row, index) => ({
        ...row,
        errors: [...row.errors, ...(shapeErrors[index] ? [shapeErrors[index]!] : [])],
      }));
      setPreview(merged);
      setCanImport(Boolean(payload.data.canImport) && merged.every(({ errors }) => errors.length === 0));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not validate this contact file.');
    } finally {
      setBusy(false);
    }
  }

  async function importRows() {
    setBusy(true);
    setError('');
    try {
      const payload = await send('/contacts/import');
      const count = Number(payload.data?.createdCount) || 0;
      reset();
      onImported(count);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import contacts. No contacts were imported.');
      setPreview([]);
      setCanImport(false);
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.compact} aria-label="Import contacts from CSV">
    <div className={styles.actions}>
      <button className="button button-secondary" type="button" onClick={() => downloadCsv('contact-template.csv', template[0]!, [template[1]!])}>Download CSV template</button>
      <label className="button button-secondary">Choose contact CSV<input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={(event) => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
      {fileName && <span className={styles.filename}>{fileName}</span>}
    </div>
    {headers.length > 0 && <>
      <div className={styles.mapping}>
        <strong>Map CSV columns</strong>
        <div className={styles.mappingFields}>
          {fields.map((field) => <label key={field}>{field === 'name' ? 'Name' : field === 'email' ? 'Email' : field === 'phone' ? 'Phone (optional)' : field === 'title' ? 'Job title (optional)' : 'Company (optional)'}
            <select value={mapping[field]} onChange={(event) => { setMapping((current) => ({ ...current, [field]: event.target.value })); setPreview([]); setCanImport(false); }}>
              <option value="-1">Not mapped</option>
              {headers.map((header, index) => <option key={index} value={String(index)}>{header}</option>)}
            </select>
          </label>)}
        </div>
        <button className="button button-secondary" type="button" disabled={busy || requiredFields.some((field) => mapping[field] === '-1')} onClick={() => void validateRows()}>{busy ? 'Validating…' : 'Preview and validate import'}</button>
      </div>
      {preview.length > 0 && <div className={styles.preview}>
        <strong>{preview.filter(({ errors }) => errors.length === 0).length} valid of {preview.length} rows</strong>
        <div className={styles.tableWrap}><table><thead><tr><th>ROW</th><th>NAME</th><th>EMAIL</th><th>COMPANY</th><th>VALIDATION</th></tr></thead><tbody>
          {preview.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.name || '—'}</td><td>{row.email || '—'}</td><td>{row.company || '—'}</td><td>{row.errors.length ? row.errors.join(' ') : 'Ready to import'}</td></tr>)}
        </tbody></table></div>
        <button className="button button-primary" type="button" disabled={busy || !canImport} onClick={() => void importRows()}>{busy ? 'Importing…' : `Import ${preview.length} contacts`}</button>
      </div>}
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {fileName && <button className={styles.reset} type="button" disabled={busy} onClick={reset}>Clear file</button>}
  </section>;
}
