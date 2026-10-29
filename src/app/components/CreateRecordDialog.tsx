'use client';

import { FormEvent } from 'react';

export default function CreateRecordDialog({ title, columns, onClose, onCreate }: { title: string; columns: string[]; onClose: () => void; onCreate: (row: string[]) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const row = columns.map((column, index) => String(form.get(`field-${index}`) ?? '').trim() || '—');
    onCreate(row);
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="record-dialog" role="dialog" aria-modal="true" aria-labelledby="record-dialog-title"><header><div><span className="auth-step">WORKSPACE PREVIEW</span><h2 id="record-dialog-title">Add {title.toLowerCase()}</h2><p>This record will be added to the current browser preview.</p></div><button type="button" aria-label="Close dialog" onClick={onClose}>×</button></header><form onSubmit={submit}><div className="record-dialog-fields">{columns.map((column, index) => <label key={`${column}-${index}`}>{column ? column.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Notes'}{index === 0 && <span> required</span>}<input name={`field-${index}`} required={index === 0} placeholder={index === 0 ? `Enter ${title.toLowerCase()} name` : 'Add a value'} /></label>)}</div><footer><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Add {title.toLowerCase()}</button></footer></form></section></div>;
}
