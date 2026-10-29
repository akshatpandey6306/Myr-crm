'use client';

import { useState } from 'react';

export default function HelpPopover() {
  const [open, setOpen] = useState(false);
  return <div className="help-popover-root"><button className="help-open-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Explore help center <span aria-hidden="true">↗</span></button>{open && <div className="help-popover"><button className="help-close" type="button" aria-label="Close help" onClick={() => setOpen(false)}>×</button><strong>Quick start</strong><p>Use the workspace menu to switch organizations. Search jumps to CRM sections, and Add opens a record form in the preview.</p><button type="button" onClick={() => setOpen(false)}>Got it</button></div>}</div>;
}
