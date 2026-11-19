'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';

type BillingTab = 'overview' | 'invoices' | 'quotations' | 'payments' | 'products' | 'settings';
type CustomerType = 'contact' | 'company' | 'custom';
type LineDraft = {
  key: string;
  productId: string;
  itemName: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountType: 'FIXED' | 'PERCENTAGE';
  discountValue: string;
  taxRate: string;
};
type BillingCustomer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company?: string | null;
  type: 'contact' | 'company';
};
type InvoicePrefill = {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  billingAddress: string | null;
};
type BillingProduct = {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  category: string | null;
  unit: string;
  sellingPrice: string;
  purchasePrice: string | null;
  taxRate: string;
  hsnSacCode: string | null;
  isActive: boolean;
};
type BillingSettings = {
  currency: string;
  currencyPrecision: number;
  countryCode: string;
  taxSystem: 'GENERIC' | 'INDIA_GST';
  businessName: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  businessAddress: string | null;
  gstin: string | null;
  registrationStateCode: string | null;
  invoicePrefix: string;
  quotePrefix: string;
  receiptPrefix: string;
  defaultDueDays: number;
  defaultTaxRate: string;
  defaultTerms: string | null;
};
type BillingInvoice = {
  id: string;
  invoiceNumber: string | null;
  customerType: CustomerType;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  status: string;
  paymentStatus: string;
  isOverdue: boolean;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  additionalCharges: string;
  shippingAmount: string;
  roundOff: string;
  grandTotal: string;
  amountPaid: string;
  balanceDue: string;
  createdAt: string;
  items?: Array<{
    id: string;
    itemName: string;
    description: string | null;
    sku: string | null;
    hsnSacCode: string | null;
    quantity: string;
    unit: string;
    unitPrice: string;
    discountAmount: string;
    discountType: string;
    discountValue: string;
    taxRate: string;
    taxAmount: string;
    lineTotal: string;
  }>;
  payments?: Array<{
    id: string;
    paymentNumber: string;
    amount: string;
    paymentDate: string;
    method: string;
    transactionReference: string | null;
    receipt: { id: string; receiptNumber: string } | null;
  }>;
};
type BillingQuotation = {
  id: string;
  quotationNumber: string | null;
  customerName: string;
  customerEmail: string | null;
  validUntil: string | null;
  currency: string;
  status: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  grandTotal: string;
  convertedInvoiceId: string | null;
  createdAt: string;
};
type BillingPayment = {
  id: string;
  paymentNumber: string;
  amount: string;
  paymentDate: string;
  method: string;
  transactionReference: string | null;
  customerName: string;
  invoiceNumber: string | null;
  currency: string;
  receiptNumber: string | null;
};
type BillingReceipt = {
  id: string;
  receiptNumber: string;
  customerName: string;
  invoiceNumber: string;
  amount: string;
  currency: string;
  paymentDate: string;
  method: string;
  transactionReference: string | null;
  previousBalance: string;
  remainingBalance: string;
  notes: string | null;
};
type BillingDashboard = {
  currency: string;
  invoices: number;
  invoiced: string;
  received: string;
  outstanding: string;
  overdueAmount: string;
  overdueCount: number;
  paidCount: number;
  partiallyPaidCount: number;
  unpaidCount: number;
  monthlyRevenue: Array<{ month: string; amount: string }>;
  recentInvoices: BillingInvoice[];
  recentPayments: Array<{
    id: string;
    paymentNumber: string;
    amount: string;
    paymentDate: string;
    method: string;
    customerName: string;
    invoiceNumber: string | null;
    receiptNumber: string | null;
  }>;
};
type PageEnvelope<T> = { data: T; meta?: { page: number; pageSize: number; total: number; totalPages: number } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(payload: unknown) {
  if (!isRecord(payload)) return 'Something went wrong. Please try again.';
  const error = isRecord(payload.error) ? payload.error : payload;
  return typeof error.message === 'string' ? error.message : 'Something went wrong. Please try again.';
}

async function request<T>(path: string, init?: RequestInit): Promise<PageEnvelope<T>> {
  const response = await crmApiFetch(`/invoicing${path}`, init);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`The billing API returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(errorMessage(payload));
  if (!isRecord(payload) || !('data' in payload)) throw new Error('The billing API returned an invalid response.');
  return payload as PageEnvelope<T>;
}

function money(value: string | number | null | undefined, currency: string, precision = 2) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

function emptyLine(): LineDraft {
  return { key: crypto.randomUUID(), productId: '', itemName: '', description: '', quantity: '1', unit: 'unit', unitPrice: '0', discountType: 'FIXED', discountValue: '0', taxRate: '0' };
}

function printValue(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function printInvoice(invoice: BillingInvoice, settings: BillingSettings | null) {
  const currency = invoice.currency || settings?.currency || 'USD';
  const rows = invoice.items?.map((item) => `
    <tr><td>${printValue(item.itemName)}<small>${printValue(item.description ?? '')}</small></td>
    <td>${printValue(item.quantity)} ${printValue(item.unit)}</td>
    <td>${money(item.unitPrice, currency, settings?.currencyPrecision ?? 2)}</td>
    <td>${money(item.discountAmount, currency, settings?.currencyPrecision ?? 2)}</td>
    <td>${printValue(item.taxRate)}%</td>
    <td>${money(item.lineTotal, currency, settings?.currencyPrecision ?? 2)}</td></tr>`).join('') ?? '';
  const documentHtml = `<!doctype html><html><head><title>${printValue(invoice.invoiceNumber ?? 'Draft invoice')}</title>
  <style>body{font:14px Arial,sans-serif;color:#20213c;margin:40px auto;max-width:820px}header,.foot{display:flex;justify-content:space-between;gap:24px}h1{font-size:30px;margin:6px 0}h2{font-size:16px;margin:28px 0 8px}p{line-height:1.55}.muted{color:#777991}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #e8e8f0}th{font-size:11px;color:#686b80}small{display:block;color:#777991;margin-top:3px}.totals{margin-left:auto;width:300px}.totals div{display:flex;justify-content:space-between;padding:6px}.grand{border-top:1px solid #ddd;padding-top:12px!important;font-weight:700;font-size:17px}.notes{white-space:pre-wrap}@media print{body{margin:0 auto}}</style></head><body>
  <header><div><strong>${printValue(settings?.businessName || 'LeadPilot')}</strong><p class="muted">${printValue(settings?.businessAddress ?? '')}<br>${printValue(settings?.businessEmail ?? '')}</p></div>
  <div><h1>INVOICE</h1><strong>${printValue(invoice.invoiceNumber ?? 'Draft')}</strong><p class="muted">Issued ${dateLabel(invoice.invoiceDate)}<br>Due ${dateLabel(invoice.dueDate)}</p></div></header>
  <h2>Bill to</h2><strong>${printValue(invoice.customerName)}</strong><p class="muted">${printValue(invoice.customerEmail ?? '')}<br>${printValue(invoice.customerPhone ?? '')}</p>
  <table><thead><tr><th>ITEM</th><th>QUANTITY</th><th>UNIT PRICE</th><th>DISCOUNT</th><th>TAX</th><th>TOTAL</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals"><div><span>Subtotal</span><strong>${money(invoice.subtotal, currency, settings?.currencyPrecision ?? 2)}</strong></div>
  <div><span>Discount</span><strong>−${money(invoice.discountAmount, currency, settings?.currencyPrecision ?? 2)}</strong></div>
  <div><span>Tax</span><strong>${money(invoice.taxAmount, currency, settings?.currencyPrecision ?? 2)}</strong></div>
  <div><span>Payments received</span><strong>${money(invoice.amountPaid, currency, settings?.currencyPrecision ?? 2)}</strong></div>
  <div class="grand"><span>Balance due</span><strong>${money(invoice.balanceDue, currency, settings?.currencyPrecision ?? 2)}</strong></div></div>
  <div class="foot"><p class="notes">${printValue(settings?.defaultTerms ?? '')}</p><p class="muted">Thank you for your business.</p></div>
  </body></html>`;
  const frame = window.document.createElement('iframe');
  frame.title = `Print ${invoice.invoiceNumber ?? 'draft invoice'}`;
  frame.style.position = 'fixed';
  frame.style.left = '-10000px';
  frame.style.width = '820px';
  frame.style.height = '1160px';
  frame.style.border = '0';
  frame.onload = () => {
    const printWindow = frame.contentWindow;
    if (!printWindow) {
      frame.remove();
      window.alert('The invoice could not be prepared for printing. Please try again.');
      return;
    }
    printWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
    printWindow.focus();
    printWindow.print();
  };
  frame.srcdoc = documentHtml;
  window.document.body.append(frame);
}

function LineItemsEditor({
  lines, products, change, add, remove,
}: {
  lines: LineDraft[];
  products: BillingProduct[];
  change: (key: string, field: keyof LineDraft, value: string) => void;
  add: () => void;
  remove: (key: string) => void;
}) {
  return <div className="billing-lines">
    <div className="billing-lines-heading"><strong>Items and services</strong><button className="button button-secondary" type="button" onClick={add}>＋ Add line</button></div>
    {lines.map((line, index) => <div className="billing-line-editor" key={line.key}>
      <label className="billing-item-product">Product / service
        <select value={line.productId} onChange={(event) => change(line.key, 'productId', event.target.value)}>
          <option value="">Custom line item</option>
          {products.filter((product) => product.isActive).map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
        </select>
      </label>
      <label>Description<input value={line.itemName} onChange={(event) => change(line.key, 'itemName', event.target.value)} required maxLength={160} placeholder="Item or service name" /></label>
      <label>Quantity<input type="number" value={line.quantity} onChange={(event) => change(line.key, 'quantity', event.target.value)} min="0.0001" step="0.0001" required /></label>
      <label>Unit<input value={line.unit} onChange={(event) => change(line.key, 'unit', event.target.value)} maxLength={24} /></label>
      <label>Unit price<input type="number" value={line.unitPrice} onChange={(event) => change(line.key, 'unitPrice', event.target.value)} min="0" step="0.0001" required /></label>
      <label>Discount type<select value={line.discountType} onChange={(event) => change(line.key, 'discountType', event.target.value)}><option value="FIXED">Amount</option><option value="PERCENTAGE">Percent</option></select></label>
      <label>Discount<input type="number" value={line.discountValue} onChange={(event) => change(line.key, 'discountValue', event.target.value)} min="0" step="0.0001" /></label>
      <label>Tax %<input type="number" value={line.taxRate} onChange={(event) => change(line.key, 'taxRate', event.target.value)} min="0" max="100" step="0.0001" /></label>
      <button className="billing-remove-line" type="button" onClick={() => remove(line.key)} disabled={lines.length === 1} aria-label={`Remove item ${index + 1}`}>×</button>
    </div>)}
  </div>;
}

function DocumentDialog({
  kind, contacts, companies, products, settings, prefill, close, saved,
}: {
  kind: 'invoice' | 'quotation';
  contacts: BillingCustomer[];
  companies: BillingCustomer[];
  products: BillingProduct[];
  settings: BillingSettings | null;
  prefill?: InvoicePrefill | null;
  close: () => void;
  saved: (message: string) => void;
}) {
  const [customerType, setCustomerType] = useState<CustomerType>(prefill ? 'custom' : 'contact');
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<{ contacts: BillingCustomer[]; companies: BillingCustomer[] } | null>(null);
  const [customerLookupError, setCustomerLookupError] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [discountType, setDiscountType] = useState<'FIXED' | 'PERCENTAGE'>('FIXED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedDraftId, setSavedDraftId] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const customers = customerType === 'contact'
    ? customerResults?.contacts ?? contacts
    : customerResults?.companies ?? companies;
  const selectedCustomer = [...contacts, ...companies, ...(customerResults?.contacts ?? []), ...(customerResults?.companies ?? [])]
    .find((customer) => customer.id === customerId);
  const customerOptions = selectedCustomer && !customers.some(({ id }) => id === selectedCustomer.id)
    ? [...customers, selectedCustomer]
    : customers;

  useEffect(() => {
    const search = customerSearch.trim();
    if (!search) {
      setCustomerResults(null);
      setCustomerLookupError('');
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCustomerLookupError('');
      try {
        const result = await request<{ contacts: BillingCustomer[]; companies: BillingCustomer[] }>(
          `/customers?q=${encodeURIComponent(search)}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setCustomerResults(result.data);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setCustomerLookupError(cause instanceof Error ? cause.message : 'Could not search workspace customers.');
        }
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [customerSearch]);

  function changeLine(key: string, field: keyof LineDraft, value: string) {
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      if (field === 'productId') {
        const product = products.find((entry) => entry.id === value);
        return product
          ? { ...line, productId: product.id, itemName: product.name, description: product.description ?? '', unit: product.unit, unitPrice: product.sellingPrice, taxRate: product.taxRate }
          : { ...line, productId: '', itemName: '', description: '', unit: 'unit', unitPrice: '0', taxRate: settings?.defaultTaxRate ?? '0' };
      }
      return { ...line, [field]: value };
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const issueNow = submitter instanceof HTMLButtonElement && submitter.value === 'issue';
    const values = new FormData(form);
    const body = {
      customerType: customerType.toUpperCase(),
      ...(customerType !== 'custom' ? { customerId } : {}),
      customerName: customerType === 'custom' ? String(values.get('customerName') ?? '').trim() : selectedCustomer?.name,
      customerEmail: customerType === 'contact' ? selectedCustomer?.email : String(values.get('customerEmail') ?? '').trim() || null,
      customerPhone: customerType === 'contact' || customerType === 'company' ? selectedCustomer?.phone : String(values.get('customerPhone') ?? '').trim() || null,
      billingAddress: String(values.get('billingAddress') ?? '').trim() || null,
      shippingAddress: String(values.get('shippingAddress') ?? '').trim() || null,
      invoiceDate: String(values.get('invoiceDate') ?? ''),
      dueDate: kind === 'invoice' ? String(values.get('dueDate') ?? '') : undefined,
      validUntil: kind === 'quotation' ? String(values.get('validUntil') ?? '') || null : undefined,
      currency: settings?.currency ?? 'USD',
      discountType,
      discountValue: String(values.get('discountValue') ?? '0'),
      additionalCharges: kind === 'invoice' ? String(values.get('additionalCharges') ?? '0') : '0',
      shippingAmount: kind === 'invoice' ? String(values.get('shippingAmount') ?? '0') : '0',
      roundOff: kind === 'invoice' ? String(values.get('roundOff') ?? '0') : '0',
      purchaseOrderNumber: String(values.get('purchaseOrderNumber') ?? '').trim() || null,
      referenceNumber: String(values.get('referenceNumber') ?? '').trim() || null,
      placeOfSupply: String(values.get('placeOfSupply') ?? '').trim() || null,
      notes: String(values.get('notes') ?? '').trim() || null,
      internalNotes: kind === 'invoice' ? String(values.get('internalNotes') ?? '').trim() || null : undefined,
      terms: String(values.get('terms') ?? '').trim() || null,
      items: lines.map((line) => ({
        ...(line.productId ? { productId: line.productId } : {}),
        itemName: line.itemName.trim(),
        description: line.description.trim() || null,
        quantity: line.quantity,
        unit: line.unit.trim() || 'unit',
        unitPrice: line.unitPrice,
        discountType: line.discountType,
        discountValue: line.discountValue,
        taxRate: line.taxRate || '0',
      })),
    };
    setBusy(true);
    setError('');
    try {
      if (kind === 'invoice' && savedDraftId) {
        await request<BillingInvoice>(`/invoices/${savedDraftId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (issueNow) {
          await request<BillingInvoice>(`/invoices/${savedDraftId}/issue`, { method: 'POST' });
          saved('Invoice issued successfully.');
        } else {
          saved('Invoice draft updated.');
        }
        return;
      }
      const result = await request<BillingInvoice | BillingQuotation>(`/${kind === 'invoice' ? 'invoices' : 'quotations'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (kind === 'invoice' && issueNow) {
        const draft = result.data as BillingInvoice;
        setSavedDraftId(draft.id);
        await request<BillingInvoice>(`/invoices/${draft.id}/issue`, { method: 'POST' });
        saved('Invoice saved and issued.');
      } else {
        saved(kind === 'invoice' ? 'Invoice draft saved.' : 'Quotation draft saved.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this document.');
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + (settings?.defaultDueDays ?? 30) * 86_400_000).toISOString().slice(0, 10);
  return <div className="dialog-backdrop billing-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
    <section className="record-dialog billing-document-dialog" role="dialog" aria-modal="true" aria-labelledby="billing-document-title">
      <header><div><span className="auth-step">{kind === 'invoice' ? 'BILLING / INVOICE' : 'BILLING / QUOTATION'}</span><h2 id="billing-document-title">{kind === 'invoice' ? 'Create invoice' : 'Create quotation'}</h2><p>Customer details and line items are saved to this workspace only.</p></div><button type="button" aria-label="Close dialog" disabled={busy} onClick={close}>×</button></header>
      <form ref={formRef} onSubmit={(event) => void submit(event)}>
        <div className="billing-form-grid">
          <label>Customer type<select value={customerType} onChange={(event) => { setCustomerType(event.target.value as CustomerType); setCustomerId(''); setCustomerSearch(''); setCustomerResults(null); }}><option value="contact">Existing contact</option><option value="company">Existing company</option><option value="custom">One-time customer</option></select></label>
          {customerType !== 'custom'
            ? <>
              <label>Search customers<input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} maxLength={120} placeholder="Search name, email, phone, or company" /></label>
              <label>Customer<select value={customerId} onChange={(event) => setCustomerId(event.target.value)} required><option value="">Select a customer</option>{customerOptions.map((customer) => <option key={`${customer.type}-${customer.id}`} value={customer.id}>{customer.name}{customer.company ? ` · ${customer.company}` : ''}</option>)}</select></label>
              {customerLookupError && <p className="billing-inline-error" role="alert">{customerLookupError}</p>}
            </>
            : <label>Customer / business name<input name="customerName" required maxLength={160} defaultValue={prefill?.customerName ?? ''} placeholder="Customer name" /></label>}
          {(customerType === 'custom' || customerType === 'company') && <label>Email<input name="customerEmail" type="email" maxLength={254} defaultValue={customerType === 'company' ? selectedCustomer?.email ?? '' : prefill?.customerEmail ?? ''} placeholder="billing@company.com" /></label>}
          {(customerType === 'custom' || customerType === 'company') && <label>Phone<input name="customerPhone" type="tel" maxLength={40} defaultValue={customerType === 'company' ? selectedCustomer?.phone ?? '' : prefill?.customerPhone ?? ''} placeholder="Phone number" /></label>}
          <label>Billing address<textarea name="billingAddress" rows={2} maxLength={2000} defaultValue={prefill?.billingAddress ?? ''} placeholder="Street, city, postal code" /></label>
          <label>Shipping address<textarea name="shippingAddress" rows={2} maxLength={2000} placeholder="Optional" /></label>
          <label>{kind === 'invoice' ? 'Invoice date' : 'Quotation date'}<input name="invoiceDate" type="date" defaultValue={today} required /></label>
          {kind === 'invoice'
            ? <label>Due date<input name="dueDate" type="date" defaultValue={due} required /></label>
            : <label>Valid until<input name="validUntil" type="date" /></label>}
          {kind === 'invoice' && <><label>Purchase order<input name="purchaseOrderNumber" maxLength={80} placeholder="Optional" /></label><label>Place of supply<input name="placeOfSupply" maxLength={120} placeholder="State / region" /></label></>}
          <label>Reference<input name="referenceNumber" maxLength={80} placeholder="Optional reference" /></label>
        </div>
        <LineItemsEditor
          lines={lines}
          products={products}
          change={changeLine}
          add={() => setLines((current) => [...current, emptyLine()])}
          remove={(key) => setLines((current) => current.length > 1 ? current.filter((line) => line.key !== key) : current)}
        />
        <div className="billing-form-grid billing-form-adjustments">
          <label>Invoice discount type<select value={discountType} onChange={(event) => setDiscountType(event.target.value as 'FIXED' | 'PERCENTAGE')}><option value="FIXED">Fixed amount</option><option value="PERCENTAGE">Percentage</option></select></label>
          <label>Invoice discount<input name="discountValue" type="number" min="0" step="0.0001" defaultValue="0" /></label>
          {kind === 'invoice' && <><label>Additional charges<input name="additionalCharges" type="number" min="0" step="0.0001" defaultValue="0" /></label><label>Shipping<input name="shippingAmount" type="number" min="0" step="0.0001" defaultValue="0" /></label><label>Round-off<input name="roundOff" type="number" step="0.0001" defaultValue="0" /></label></>}
          <label>Customer notes<textarea name="notes" rows={2} maxLength={4000} placeholder="Visible to the customer" /></label>
          {kind === 'invoice' && <label>Internal notes<textarea name="internalNotes" rows={2} maxLength={4000} placeholder="Never shown on printed invoice" /></label>}
          <label>Terms and conditions<textarea name="terms" rows={2} maxLength={6000} defaultValue={settings?.defaultTerms ?? ''} /></label>
        </div>
        <p className="billing-currency-note">Amounts are calculated securely using {settings?.currency ?? 'USD'} precision; the server is the source of truth.</p>
        {error && <p className="billing-inline-error" role="alert">{error}</p>}
        <footer>
          <button className="button button-secondary" type="button" disabled={busy} onClick={close}>Cancel</button>
          <button className="button button-primary" type="submit" name="action" value="draft" disabled={busy}>{busy ? 'Saving…' : savedDraftId ? 'Save draft changes' : 'Save draft'}</button>
          {kind === 'invoice' && <button className="button button-primary billing-issue-button" type="submit" name="action" value="issue" disabled={busy}>{busy ? 'Working…' : savedDraftId ? 'Retry issue' : 'Save & issue'}</button>}
        </footer>
      </form>
    </section>
  </div>;
}

function PaymentDialog({ invoice, close, saved }: { invoice: BillingInvoice; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const idempotencyKey = useRef('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    setBusy(true);
    setError('');
    try {
      await request(`/invoices/${invoice.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey.current },
        body: JSON.stringify({
          amount: String(values.get('amount') ?? ''),
          method: String(values.get('method') ?? 'CASH'),
          paymentDate: new Date(String(values.get('paymentDate') ?? '')).toISOString(),
          transactionReference: String(values.get('transactionReference') ?? '').trim() || null,
          notes: String(values.get('notes') ?? '').trim() || null,
        }),
      });
      saved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record this payment.');
    } finally {
      setBusy(false);
    }
  }
  return <div className="dialog-backdrop billing-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
    <section className="record-dialog billing-small-dialog" role="dialog" aria-modal="true" aria-labelledby="billing-payment-title">
      <header><div><span className="auth-step">RECEIPT IS CREATED AUTOMATICALLY</span><h2 id="billing-payment-title">Record a payment</h2><p>{invoice.invoiceNumber ?? 'Invoice'} · Balance {money(invoice.balanceDue, invoice.currency)}</p></div><button type="button" aria-label="Close dialog" disabled={busy} onClick={close}>×</button></header>
      <form onSubmit={(event) => void submit(event)} onChange={() => { if (!busy) idempotencyKey.current = ''; }}>
        <div className="billing-form-grid">
          <label>Amount received<input name="amount" type="number" min="0.0001" max={invoice.balanceDue} step="0.0001" required /></label>
          <label>Payment method<select name="method"><option value="UPI">UPI</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="CARD">Credit / debit card</option><option value="CHEQUE">Cheque</option><option value="PAYMENT_GATEWAY">Payment gateway</option><option value="OTHER">Other</option></select></label>
          <label>Payment date<input name="paymentDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
          <label>Transaction reference<input name="transactionReference" maxLength={120} placeholder="Optional" /></label>
          <label>Notes<textarea name="notes" rows={2} maxLength={2000} /></label>
        </div>
        {error && <p className="billing-inline-error" role="alert">{error}</p>}
        <footer><button className="button button-secondary" type="button" disabled={busy} onClick={close}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record payment & receipt'}</button></footer>
      </form>
    </section>
  </div>;
}

function ProductDialog({ close, saved }: { close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await request('/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(values.get('name') ?? '').trim(),
          sku: String(values.get('sku') ?? '').trim(),
          description: String(values.get('description') ?? '').trim() || null,
          category: String(values.get('category') ?? '').trim() || null,
          unit: String(values.get('unit') ?? 'unit').trim() || 'unit',
          sellingPrice: String(values.get('sellingPrice') ?? ''),
          purchasePrice: String(values.get('purchasePrice') ?? '') || null,
          taxRate: String(values.get('taxRate') ?? '0'),
          hsnSacCode: String(values.get('hsnSacCode') ?? '').trim() || null,
        }),
      });
      saved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this product.');
    } finally {
      setBusy(false);
    }
  }
  return <div className="dialog-backdrop billing-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
    <section className="record-dialog billing-small-dialog" role="dialog" aria-modal="true" aria-labelledby="billing-product-title">
      <header><div><span className="auth-step">PRODUCT CATALOGUE</span><h2 id="billing-product-title">Add product or service</h2><p>Product records are private to the active workspace.</p></div><button type="button" aria-label="Close dialog" disabled={busy} onClick={close}>×</button></header>
      <form onSubmit={(event) => void submit(event)}>
        <div className="billing-form-grid">
          <label>Name<input name="name" required maxLength={160} autoFocus /></label>
          <label>SKU / code<input name="sku" required maxLength={64} /></label>
          <label>Selling price<input name="sellingPrice" type="number" min="0" step="0.0001" required /></label>
          <label>Purchase price<input name="purchasePrice" type="number" min="0" step="0.0001" /></label>
          <label>Tax rate %<input name="taxRate" type="number" min="0" max="100" step="0.0001" defaultValue="0" /></label>
          <label>Unit<input name="unit" maxLength={24} defaultValue="unit" /></label>
          <label>Category<input name="category" maxLength={120} /></label>
          <label>HSN / SAC<input name="hsnSacCode" maxLength={32} /></label>
          <label className="billing-full-field">Description<textarea name="description" rows={2} maxLength={4000} /></label>
        </div>
        {error && <p className="billing-inline-error" role="alert">{error}</p>}
        <footer><button className="button button-secondary" type="button" disabled={busy} onClick={close}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button></footer>
      </form>
    </section>
  </div>;
}

function SettingsForm({ settings, saved }: { settings: BillingSettings; saved: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await request('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: String(values.get('businessName') ?? '').trim() || null,
          businessEmail: String(values.get('businessEmail') ?? '').trim() || null,
          businessPhone: String(values.get('businessPhone') ?? '').trim() || null,
          businessAddress: String(values.get('businessAddress') ?? '').trim() || null,
          gstin: String(values.get('gstin') ?? '').trim() || null,
          registrationStateCode: String(values.get('registrationStateCode') ?? '').trim() || null,
          currency: String(values.get('currency') ?? settings.currency).toUpperCase(),
          currencyPrecision: Number(values.get('currencyPrecision') ?? settings.currencyPrecision),
          countryCode: String(values.get('countryCode') ?? settings.countryCode).toUpperCase(),
          taxSystem: String(values.get('taxSystem') ?? settings.taxSystem),
          invoicePrefix: String(values.get('invoicePrefix') ?? '').trim(),
          quotePrefix: String(values.get('quotePrefix') ?? '').trim(),
          receiptPrefix: String(values.get('receiptPrefix') ?? '').trim(),
          defaultDueDays: Number(values.get('defaultDueDays') ?? 30),
          defaultTaxRate: String(values.get('defaultTaxRate') ?? '0'),
          defaultTerms: String(values.get('defaultTerms') ?? '').trim() || null,
        }),
      });
      saved('Billing settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save billing settings.');
    } finally {
      setBusy(false);
    }
  }
  return <form className="billing-settings-form panel" onSubmit={(event) => void submit(event)}>
    <div className="billing-section-heading"><div><span className="auth-step">WORKSPACE CONFIGURATION</span><h2>Billing settings</h2><p>Invoice numbering, business details, currency, and tax defaults.</p></div></div>
    <div className="billing-form-grid">
      <label>Business name<input name="businessName" defaultValue={settings.businessName ?? ''} maxLength={160} /></label>
      <label>Business email<input name="businessEmail" type="email" defaultValue={settings.businessEmail ?? ''} maxLength={254} /></label>
      <label>Business phone<input name="businessPhone" defaultValue={settings.businessPhone ?? ''} maxLength={40} /></label>
      <label>Country code<input name="countryCode" defaultValue={settings.countryCode} maxLength={2} minLength={2} /></label>
      <label>Currency<input name="currency" defaultValue={settings.currency} maxLength={3} minLength={3} /></label>
      <label>Currency precision<select name="currencyPrecision" defaultValue={settings.currencyPrecision}><option value="0">0 decimals</option><option value="2">2 decimals</option><option value="3">3 decimals</option><option value="4">4 decimals</option></select></label>
      <label>Tax system<select name="taxSystem" defaultValue={settings.taxSystem}><option value="GENERIC">Generic tax</option><option value="INDIA_GST">India GST</option></select></label>
      <label>Default tax rate %<input name="defaultTaxRate" type="number" min="0" max="100" step="0.0001" defaultValue={settings.defaultTaxRate} /></label>
      <label>GSTIN<input name="gstin" defaultValue={settings.gstin ?? ''} maxLength={32} /></label>
      <label>Registration state code<input name="registrationStateCode" defaultValue={settings.registrationStateCode ?? ''} maxLength={8} /></label>
      <label>Default due days<input name="defaultDueDays" type="number" min="0" max="365" defaultValue={settings.defaultDueDays} /></label>
      <label>Invoice prefix<input name="invoicePrefix" defaultValue={settings.invoicePrefix} maxLength={12} required /></label>
      <label>Quotation prefix<input name="quotePrefix" defaultValue={settings.quotePrefix} maxLength={12} required /></label>
      <label>Receipt prefix<input name="receiptPrefix" defaultValue={settings.receiptPrefix} maxLength={12} required /></label>
      <label className="billing-full-field">Registered address<textarea name="businessAddress" rows={2} defaultValue={settings.businessAddress ?? ''} maxLength={4000} /></label>
      <label className="billing-full-field">Default payment terms<textarea name="defaultTerms" rows={3} defaultValue={settings.defaultTerms ?? ''} maxLength={6000} /></label>
    </div>
    <p className="billing-settings-note">Tax is only calculated from the tax rate saved on each product or line item. Configure GST details with your accountant; the CRM does not infer a legally applicable tax rate.</p>
    {error && <p className="billing-inline-error" role="alert">{error}</p>}
    <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save billing settings'}</button>
  </form>;
}

function InvoiceDetails({ invoice, settings, close, refresh }: {
  invoice: BillingInvoice;
  settings: BillingSettings | null;
  close: () => void;
  refresh: () => void;
}) {
  const [current, setCurrent] = useState(invoice);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void request<BillingInvoice>(`/invoices/${invoice.id}`)
      .then((response) => { if (active) setCurrent(response.data); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load invoice details.'); });
    return () => { active = false; };
  }, [invoice.id]);
  async function action(path: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      await request(path, { method: 'POST', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      refresh();
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this invoice.');
    } finally { setBusy(false); }
  }
  const canCancel = current.status === 'draft' || (current.status === 'issued' && Number(current.amountPaid) === 0);
  return <div className="dialog-backdrop billing-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
    <section className="record-dialog billing-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="billing-detail-title">
      <header><div><span className="auth-step">{current.status.toUpperCase()} INVOICE</span><h2 id="billing-detail-title">{current.invoiceNumber ?? 'Draft invoice'}</h2><p>{current.customerName} · Due {dateLabel(current.dueDate)}</p></div><button type="button" aria-label="Close dialog" disabled={busy} onClick={close}>×</button></header>
      <div className="billing-detail-content">
        <div className="billing-detail-stats"><div><span>Invoice total</span><strong>{money(current.grandTotal, current.currency, settings?.currencyPrecision)}</strong></div><div><span>Received</span><strong>{money(current.amountPaid, current.currency, settings?.currencyPrecision)}</strong></div><div><span>Balance due</span><strong>{money(current.balanceDue, current.currency, settings?.currencyPrecision)}</strong></div></div>
        <div className="table-scroll"><table className="billing-table"><thead><tr><th>ITEM</th><th>QTY</th><th>UNIT PRICE</th><th>DISCOUNT</th><th>TAX</th><th>TOTAL</th></tr></thead><tbody>{current.items?.map((item) => <tr key={item.id}><td><strong>{item.itemName}</strong>{item.description && <small>{item.description}</small>}</td><td>{item.quantity} {item.unit}</td><td>{money(item.unitPrice, current.currency, settings?.currencyPrecision)}</td><td>{money(item.discountAmount, current.currency, settings?.currencyPrecision)}</td><td>{item.taxRate}%</td><td>{money(item.lineTotal, current.currency, settings?.currencyPrecision)}</td></tr>)}</tbody></table></div>
        {current.payments?.length ? <div className="billing-payment-history"><strong>Payment history</strong>{current.payments.map((payment) => <div key={payment.id}><span>{payment.paymentNumber} · {payment.method} · {dateLabel(payment.paymentDate)}</span><b>{money(payment.amount, current.currency, settings?.currencyPrecision)} {payment.receipt && <small>Receipt {payment.receipt.receiptNumber}</small>}</b></div>)}</div> : null}
        {error && <p className="billing-inline-error" role="alert">{error}</p>}
      </div>
      <footer>
        <button className="button button-secondary" type="button" onClick={() => printInvoice(current, settings)}>Print / save PDF</button>
        {current.customerEmail && <a className="button button-secondary" href={`mailto:${encodeURIComponent(current.customerEmail)}?subject=${encodeURIComponent(`Invoice ${current.invoiceNumber ?? ''}`)}`}>Email</a>}
        {current.status === 'draft' && <button className="button button-primary" type="button" disabled={busy} onClick={() => void action(`/invoices/${current.id}/issue`)}>Issue invoice</button>}
        {current.status === 'issued' && Number(current.balanceDue) > 0 && <button className="button button-primary" type="button" disabled={busy} onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Invoice ${current.invoiceNumber} for ${money(current.balanceDue, current.currency)} is due. Please contact us for payment details.`)}`, '_blank', 'noopener,noreferrer')}>Share on WhatsApp</button>}
        {canCancel && <button className="button button-danger" type="button" disabled={busy} onClick={() => { if (window.confirm(`Cancel ${current.invoiceNumber ?? 'this draft'}?`)) void action(`/invoices/${current.id}/cancel`, { reason: 'Cancelled by workspace user' }); }}>Cancel invoice</button>}
        <button className="button button-secondary" type="button" onClick={close}>Close</button>
      </footer>
    </section>
  </div>;
}

export default function BillingManager() {
  const [tab, setTab] = useState<BillingTab>('overview');
  const [dashboard, setDashboard] = useState<BillingDashboard | null>(null);
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [products, setProducts] = useState<BillingProduct[]>([]);
  const [contacts, setContacts] = useState<BillingCustomer[]>([]);
  const [companies, setCompanies] = useState<BillingCustomer[]>([]);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [quotations, setQuotations] = useState<BillingQuotation[]>([]);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [receipts, setReceipts] = useState<BillingReceipt[]>([]);
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoicePages, setInvoicePages] = useState(1);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [quotePage, setQuotePage] = useState(1);
  const [quotePages, setQuotePages] = useState(1);
  const [quoteTotal, setQuoteTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<'invoice' | 'quotation' | 'product' | null>(null);
  const [invoicePrefill, setInvoicePrefill] = useState<InvoicePrefill | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<BillingInvoice | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<BillingInvoice | null>(null);
  const [showReceipts, setShowReceipts] = useState(false);
  const [productQuery, setProductQuery] = useState('');

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('newInvoice') !== '1') return;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    try {
      const raw = sessionStorage.getItem('myr.billing.invoicePrefill');
      sessionStorage.removeItem('myr.billing.invoicePrefill');
      if (!raw) throw new Error('Lead details were not available to start this invoice.');
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value) || typeof value.customerName !== 'string' || !value.customerName.trim()) {
        throw new Error('Lead details were invalid. Reopen the lead and try again.');
      }
      setInvoicePrefill({
        customerName: value.customerName.trim(),
        customerEmail: typeof value.customerEmail === 'string' ? value.customerEmail : null,
        customerPhone: typeof value.customerPhone === 'string' ? value.customerPhone : null,
        billingAddress: typeof value.billingAddress === 'string' ? value.billingAddress : null,
      });
      setDialog('invoice');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load lead details for the invoice.');
    }
  }, []);

  useEffect(() => {
    const clearWorkspaceData = () => {
      setDashboard(null); setSettings(null); setProducts([]); setContacts([]); setCompanies([]);
      setInvoices([]); setQuotations([]); setPayments([]); setReceipts([]);
      setInvoicePage(1); setQuotePage(1); setNotice(''); setError(''); setLoading(true);
      setRefresh((value) => value + 1);
    };
    const refreshDemoData = () => setRefresh((value) => value + 1);
    window.addEventListener('myr:organization-changed', clearWorkspaceData);
    window.addEventListener('myr:demo-data-changed', refreshDemoData);
    return () => {
      window.removeEventListener('myr:organization-changed', clearWorkspaceData);
      window.removeEventListener('myr:demo-data-changed', refreshDemoData);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [dashboardResult, settingsResult, productsResult, customersResult] = await Promise.all([
          request<BillingDashboard>('/dashboard', { signal: controller.signal }),
          request<BillingSettings>('/settings', { signal: controller.signal }),
          request<BillingProduct[]>('/products', { signal: controller.signal }),
          request<{ contacts: BillingCustomer[]; companies: BillingCustomer[] }>('/customers', { signal: controller.signal }),
        ]);
        if (!active) return;
        setDashboard(dashboardResult.data);
        setSettings(settingsResult.data);
        setProducts(productsResult.data);
        setContacts(customersResult.data.contacts);
        setCompanies(customersResult.data.companies);
        if (tab === 'invoices') {
          const params = new URLSearchParams({ page: String(invoicePage), pageSize: '10', status: invoiceStatus });
          if (query.trim()) params.set('q', query.trim());
          const result = await request<BillingInvoice[]>(`/invoices?${params}`, { signal: controller.signal });
          if (active) { setInvoices(result.data); setInvoicePages(result.meta?.totalPages ?? 1); setInvoiceTotal(result.meta?.total ?? 0); }
        } else if (tab === 'quotations') {
          const params = new URLSearchParams({ page: String(quotePage), pageSize: '10' });
          if (query.trim()) params.set('q', query.trim());
          const result = await request<BillingQuotation[]>(`/quotations?${params}`, { signal: controller.signal });
          if (active) { setQuotations(result.data); setQuotePages(result.meta?.totalPages ?? 1); setQuoteTotal(result.meta?.total ?? 0); }
        } else if (tab === 'payments') {
          const [paymentResult, receiptResult] = await Promise.all([
            request<BillingPayment[]>('/payments', { signal: controller.signal }),
            request<BillingReceipt[]>('/receipts', { signal: controller.signal }),
          ]);
          if (active) { setPayments(paymentResult.data); setReceipts(receiptResult.data); }
        } else if (tab === 'products') {
          const params = productQuery.trim() ? `?q=${encodeURIComponent(productQuery.trim())}` : '';
          const result = await request<BillingProduct[]>(`/products${params}`, { signal: controller.signal });
          if (active) setProducts(result.data);
        }
      } catch (cause) {
        if (active && !(cause instanceof Error && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : 'Could not load billing data.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [tab, invoicePage, quotePage, query, invoiceStatus, productQuery, refresh]);

  const currency = settings?.currency ?? dashboard?.currency ?? 'USD';
  const metrics = useMemo(() => [
    { label: 'Total invoiced', value: dashboard?.invoiced ?? '0', icon: '↗', tone: 'violet' },
    { label: 'Received', value: dashboard?.received ?? '0', icon: '✓', tone: 'mint' },
    { label: 'Outstanding', value: dashboard?.outstanding ?? '0', icon: '◷', tone: 'amber' },
    { label: 'Overdue', value: dashboard?.overdueAmount ?? '0', icon: '!', tone: 'rose' },
  ], [dashboard]);

  function saved(message: string) {
    setDialog(null); setInvoicePrefill(null); setPaymentInvoice(null); setSelectedInvoice(null);
    setNotice(message);
    setRefresh((value) => value + 1);
  }

  function openInvoiceDialog() {
    setInvoicePrefill(null);
    setDialog('invoice');
  }

  function closeDocumentDialog() {
    setDialog(null);
    setInvoicePrefill(null);
  }

  async function issueInvoice(invoice: BillingInvoice) {
    try {
      await request(`/invoices/${invoice.id}/issue`, { method: 'POST' });
      saved(`${invoice.invoiceNumber ?? 'Invoice'} was issued.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not issue invoice.'); }
  }

  async function updateQuote(quote: BillingQuotation, status: 'SENT' | 'ACCEPTED') {
    try {
      if (status === 'ACCEPTED' && quote.status !== 'sent') {
        await request(`/quotations/${quote.id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SENT' }) });
      }
      await request(`/quotations/${quote.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setNotice(status === 'SENT' ? 'Quotation marked as sent.' : 'Quotation accepted.');
      setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update quotation.'); }
  }

  async function convertQuote(quote: BillingQuotation) {
    try {
      await request<BillingInvoice>(`/quotations/${quote.id}/convert`, { method: 'POST' });
      setNotice('Accepted quotation converted to an issued invoice.');
      setTab('invoices'); setInvoicePage(1); setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not convert quotation.'); }
  }

  async function saveSettings(message: string) {
    setNotice(message);
    setRefresh((value) => value + 1);
  }

  const tabs: Array<{ id: BillingTab; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: '◫' },
    { id: 'invoices', label: 'Invoices', icon: '▤' },
    { id: 'quotations', label: 'Quotations', icon: '▧' },
    { id: 'payments', label: 'Payments & receipts', icon: '↔' },
    { id: 'products', label: 'Products & services', icon: '◇' },
    { id: 'settings', label: 'Billing settings', icon: '⚙' },
  ];

  return <section className="billing-feature">
    <header className="billing-page-heading">
      <div><p className="date-label">WORKSPACE / FINANCE</p><h1>Billing &amp; Invoicing</h1><p className="welcome-copy">Create invoices, track collections, and keep every customer balance in sync.</p></div>
      <div className="billing-heading-actions"><button className="button button-secondary" type="button" onClick={() => setDialog('quotation')}>＋ New quotation</button><button className="button button-primary" type="button" onClick={openInvoiceDialog}>＋ Create invoice</button></div>
    </header>
    <nav className="billing-tabs" aria-label="Billing sections">
      {tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setQuery(''); }}>{item.icon}<span>{item.label}</span></button>)}
    </nav>
    {notice && <div className="module-notice billing-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="leads-error billing-error" role="alert"><span>{error}</span><button type="button" onClick={() => { setError(''); setRefresh((value) => value + 1); }}>Retry</button></div>}
    {loading && !dashboard && <div className="panel billing-loading" role="status">Loading workspace billing data…</div>}

    {tab === 'overview' && dashboard && <div className="billing-dashboard">
      <div className="billing-metrics">{metrics.map((metric) => <article className={`billing-metric billing-metric-${metric.tone}`} key={metric.label}><span className="billing-metric-icon">{metric.icon}</span><div><span>{metric.label}</span><strong>{money(metric.value, currency, settings?.currencyPrecision)}</strong><small>{metric.label === 'Overdue' ? `${dashboard.overdueCount} invoices past due` : `${dashboard.invoices} issued invoices`}</small></div></article>)}</div>
      <div className="billing-dashboard-grid">
        <section className="panel billing-chart-panel"><div className="billing-section-heading"><div><span className="auth-step">COLLECTIONS</span><h2>Monthly revenue</h2><p>Payments recorded in the last six months</p></div><span className="billing-chart-caption">{currency}</span></div>
          <div className="billing-chart" role="img" aria-label="Monthly revenue chart">{dashboard.monthlyRevenue.map((point) => {
            const maximum = Math.max(1, ...dashboard.monthlyRevenue.map((row) => Number(row.amount) || 0));
            const height = Math.max(4, (Number(point.amount) / maximum) * 100);
            return <div className="billing-chart-column" key={point.month}><span title={money(point.amount, currency, settings?.currencyPrecision)} style={{ height: `${height}%` }} /><small>{point.month}</small></div>;
          })}</div>
        </section>
        <section className="panel billing-status-panel"><div className="billing-section-heading"><div><span className="auth-step">INVOICE STATUS</span><h2>Collection snapshot</h2></div></div>
          <div className="billing-status-row"><span><i className="paid" />Paid</span><strong>{dashboard.paidCount}</strong></div>
          <div className="billing-status-row"><span><i className="partial" />Partially paid</span><strong>{dashboard.partiallyPaidCount}</strong></div>
          <div className="billing-status-row"><span><i className="unpaid" />Unpaid</span><strong>{dashboard.unpaidCount}</strong></div>
          <button className="billing-text-link" type="button" onClick={() => { setTab('invoices'); setInvoiceStatus('OVERDUE'); }}>Review overdue invoices <span>→</span></button>
        </section>
      </div>
      <section className="panel billing-recent-panel"><div className="billing-section-heading"><div><span className="auth-step">RECENT ACTIVITY</span><h2>Latest invoices</h2></div><button className="billing-text-link" type="button" onClick={() => setTab('invoices')}>View all →</button></div>
        {dashboard.recentInvoices.length ? <div className="table-scroll"><table className="billing-table"><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>ISSUED</th><th>STATUS</th><th>TOTAL</th></tr></thead><tbody>{dashboard.recentInvoices.map((invoice) => <tr key={invoice.id} onClick={() => setSelectedInvoice(invoice)}><td><strong>{invoice.invoiceNumber ?? 'Draft'}</strong></td><td>{invoice.customerName}</td><td>{dateLabel(invoice.invoiceDate)}</td><td><span className={`billing-status-badge billing-status-${invoice.isOverdue ? 'overdue' : invoice.paymentStatus}`}>{invoice.isOverdue ? 'Overdue' : invoice.paymentStatus.replace('_', ' ')}</span></td><td>{money(invoice.grandTotal, invoice.currency, settings?.currencyPrecision)}</td></tr>)}</tbody></table></div> : <div className="billing-empty"><span>▤</span><strong>No invoices yet</strong><p>Create your first invoice to see financial activity here.</p><button className="button button-primary" type="button" onClick={openInvoiceDialog}>Create invoice</button></div>}
      </section>
    </div>}

    {tab === 'invoices' && <section className="panel billing-list-panel">
      <div className="billing-list-toolbar"><div><span className="auth-step">WORKSPACE RECORDS</span><h2>Invoices <small>{invoiceTotal}</small></h2></div><div className="billing-list-filters"><label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setInvoicePage(1); }} placeholder="Search invoice or customer…" aria-label="Search invoices" /></label><select aria-label="Filter invoices" value={invoiceStatus} onChange={(event) => { setInvoiceStatus(event.target.value); setInvoicePage(1); }}><option value="ALL">All invoices</option><option value="DRAFT">Draft</option><option value="ISSUED">Issued</option><option value="PAID">Paid</option><option value="PARTIALLY_PAID">Partially paid</option><option value="UNPAID">Unpaid</option><option value="OVERDUE">Overdue</option><option value="CANCELLED">Cancelled</option></select></div></div>
      {invoices.length ? <div className="table-scroll"><table className="billing-table"><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE / DUE</th><th>TOTAL</th><th>PAID</th><th>BALANCE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><button className="billing-record-link" type="button" onClick={() => setSelectedInvoice(invoice)}>{invoice.invoiceNumber ?? 'Draft'}</button></td><td>{invoice.customerName}</td><td>{dateLabel(invoice.invoiceDate)}<small>Due {dateLabel(invoice.dueDate)}</small></td><td>{money(invoice.grandTotal, invoice.currency, settings?.currencyPrecision)}</td><td>{money(invoice.amountPaid, invoice.currency, settings?.currencyPrecision)}</td><td>{money(invoice.balanceDue, invoice.currency, settings?.currencyPrecision)}</td><td><span className={`billing-status-badge billing-status-${invoice.isOverdue ? 'overdue' : invoice.status === 'cancelled' ? 'cancelled' : invoice.paymentStatus}`}>{invoice.isOverdue ? 'Overdue' : invoice.status === 'draft' ? 'Draft' : invoice.paymentStatus.replace('_', ' ')}</span></td><td><div className="billing-row-actions"><button type="button" onClick={() => setSelectedInvoice(invoice)}>View</button>{invoice.status === 'draft' && <button type="button" onClick={() => void issueInvoice(invoice)}>Issue</button>}{invoice.status === 'issued' && Number(invoice.balanceDue) > 0 && <button type="button" onClick={() => setPaymentInvoice(invoice)}>Payment</button>}</div></td></tr>)}</tbody></table></div> : !loading && <div className="billing-empty"><span>▤</span><strong>{query ? 'No matching invoices' : 'No invoices in this view'}</strong><p>Try changing the status filter or create an invoice.</p>{!query && <button className="button button-primary" type="button" onClick={openInvoiceDialog}>Create invoice</button>}</div>}
      <div className="module-table-footer"><span>Showing {invoices.length} of {invoiceTotal} invoices</span><div className="table-pagination"><button type="button" disabled={invoicePage <= 1 || loading} onClick={() => setInvoicePage((page) => page - 1)}>Previous</button><span>Page {invoicePage} of {Math.max(1, invoicePages)}</span><button type="button" disabled={invoicePage >= invoicePages || loading} onClick={() => setInvoicePage((page) => page + 1)}>Next</button></div></div>
    </section>}

    {tab === 'quotations' && <section className="panel billing-list-panel">
      <div className="billing-list-toolbar"><div><span className="auth-step">ESTIMATES</span><h2>Quotations <small>{quoteTotal}</small></h2></div><div className="billing-list-filters"><label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setQuotePage(1); }} placeholder="Search quotations…" aria-label="Search quotations" /></label><button className="button button-primary" type="button" onClick={() => setDialog('quotation')}>＋ New quotation</button></div></div>
      {quotations.length ? <div className="table-scroll"><table className="billing-table"><thead><tr><th>QUOTE</th><th>CUSTOMER</th><th>CREATED</th><th>VALID UNTIL</th><th>TOTAL</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{quotations.map((quote) => <tr key={quote.id}><td><strong>{quote.quotationNumber ?? 'Draft quote'}</strong></td><td>{quote.customerName}</td><td>{dateLabel(quote.createdAt)}</td><td>{dateLabel(quote.validUntil)}</td><td>{money(quote.grandTotal, quote.currency, settings?.currencyPrecision)}</td><td><span className={`billing-status-badge billing-status-${quote.status}`}>{quote.status}</span></td><td><div className="billing-row-actions">{quote.status === 'draft' && <button type="button" onClick={() => void updateQuote(quote, 'SENT')}>Mark sent</button>}{quote.status === 'sent' && <button type="button" onClick={() => void updateQuote(quote, 'ACCEPTED')}>Accept</button>}{quote.status === 'accepted' && <button type="button" onClick={() => void convertQuote(quote)}>Convert</button>}{quote.status === 'converted' && <span>Converted</span>}</div></td></tr>)}</tbody></table></div> : !loading && <div className="billing-empty"><span>▧</span><strong>No quotations yet</strong><p>Build an estimate and convert it after the customer accepts.</p><button className="button button-primary" type="button" onClick={() => setDialog('quotation')}>Create quotation</button></div>}
      <div className="module-table-footer"><span>Showing {quotations.length} of {quoteTotal} quotations</span><div className="table-pagination"><button type="button" disabled={quotePage <= 1 || loading} onClick={() => setQuotePage((page) => page - 1)}>Previous</button><span>Page {quotePage} of {Math.max(1, quotePages)}</span><button type="button" disabled={quotePage >= quotePages || loading} onClick={() => setQuotePage((page) => page + 1)}>Next</button></div></div>
    </section>}

    {tab === 'payments' && <section className="panel billing-list-panel">
      <div className="billing-list-toolbar"><div><span className="auth-step">COLLECTION HISTORY</span><h2>{showReceipts ? 'Receipts' : 'Payments'}</h2></div><div className="billing-list-filters"><button className={`billing-toggle${!showReceipts ? ' active' : ''}`} type="button" onClick={() => setShowReceipts(false)}>Payments</button><button className={`billing-toggle${showReceipts ? ' active' : ''}`} type="button" onClick={() => setShowReceipts(true)}>Receipts</button></div></div>
      {!showReceipts ? payments.length ? <div className="table-scroll"><table className="billing-table"><thead><tr><th>PAYMENT</th><th>CUSTOMER</th><th>INVOICE</th><th>DATE</th><th>METHOD</th><th>AMOUNT</th><th>RECEIPT</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td><strong>{payment.paymentNumber}</strong></td><td>{payment.customerName}</td><td>{payment.invoiceNumber ?? '—'}</td><td>{dateLabel(payment.paymentDate)}</td><td>{payment.method.replace('_', ' ')}</td><td>{money(payment.amount, payment.currency, settings?.currencyPrecision)}</td><td>{payment.receiptNumber ?? '—'}</td></tr>)}</tbody></table></div> : <div className="billing-empty"><span>↔</span><strong>No payments recorded</strong><p>Record a payment from an issued invoice to generate a receipt.</p><button className="billing-text-link" type="button" onClick={() => setTab('invoices')}>Open invoices →</button></div> : receipts.length ? <div className="table-scroll"><table className="billing-table"><thead><tr><th>RECEIPT</th><th>CUSTOMER</th><th>INVOICE</th><th>DATE</th><th>METHOD</th><th>AMOUNT</th><th>BALANCE AFTER</th></tr></thead><tbody>{receipts.map((receipt) => <tr key={receipt.id}><td><strong>{receipt.receiptNumber}</strong></td><td>{receipt.customerName}</td><td>{receipt.invoiceNumber}</td><td>{dateLabel(receipt.paymentDate)}</td><td>{receipt.method.replace('_', ' ')}</td><td>{money(receipt.amount, receipt.currency, settings?.currencyPrecision)}</td><td>{money(receipt.remainingBalance, receipt.currency, settings?.currencyPrecision)}</td></tr>)}</tbody></table></div> : <div className="billing-empty"><span>▧</span><strong>No receipts yet</strong><p>Every recorded payment creates a linked receipt.</p></div>}
    </section>}

    {tab === 'products' && <section className="panel billing-list-panel">
      <div className="billing-list-toolbar"><div><span className="auth-step">CATALOGUE</span><h2>Products &amp; services <small>{products.length}</small></h2></div><div className="billing-list-filters"><label className="module-search"><span aria-hidden="true">⌕</span><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Search products…" aria-label="Search products" /></label><button className="button button-primary" type="button" onClick={() => setDialog('product')}>＋ Add product</button></div></div>
      {products.length ? <div className="table-scroll"><table className="billing-table"><thead><tr><th>PRODUCT / SERVICE</th><th>SKU</th><th>CATEGORY</th><th>UNIT PRICE</th><th>TAX</th><th>STATUS</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong>{product.description && <small>{product.description}</small>}</td><td>{product.sku}</td><td>{product.category ?? '—'}</td><td>{money(product.sellingPrice, currency, settings?.currencyPrecision)}</td><td>{product.taxRate}%</td><td><span className={`billing-status-badge ${product.isActive ? 'billing-status-paid' : 'billing-status-cancelled'}`}>{product.isActive ? 'Active' : 'Inactive'}</span></td></tr>)}</tbody></table></div> : !loading && <div className="billing-empty"><span>◇</span><strong>No products or services yet</strong><p>Add reusable catalogue items to speed up invoice creation.</p><button className="button button-primary" type="button" onClick={() => setDialog('product')}>Add product</button></div>}
    </section>}

    {tab === 'settings' && settings && <SettingsForm settings={settings} saved={saveSettings} />}

    {dialog === 'invoice' || dialog === 'quotation' ? <DocumentDialog
      kind={dialog}
      contacts={contacts}
      companies={companies}
      products={products}
      settings={settings}
      prefill={dialog === 'invoice' ? invoicePrefill : null}
      close={closeDocumentDialog}
      saved={saved}
    /> : null}
    {dialog === 'product' && <ProductDialog close={() => setDialog(null)} saved={() => saved('Product saved to this workspace.')} />}
    {paymentInvoice && <PaymentDialog invoice={paymentInvoice} close={() => setPaymentInvoice(null)} saved={() => saved('Payment recorded and receipt generated.')} />}
    {selectedInvoice && <InvoiceDetails invoice={selectedInvoice} settings={settings} close={() => setSelectedInvoice(null)} refresh={() => setRefresh((value) => value + 1)} />}
  </section>;
}
