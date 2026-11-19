'use client';

import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import { billingIntervalLabel } from '../../../lib/billing-interval';

type Plan = { code: string; name: string; currency: string; monthlyPrice: number; billingInterval: number };
type Payment = {
  id: string;
  planCode: string;
  paymentType: string;
  transactionId: string;
  amount: string;
  currency: string;
  status: string;
  payuId: string | null;
  bankReference: string | null;
  failureReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
  organizationName: string;
  customerName: string;
  customerEmail: string;
};

export default function WorkspaceBillingSettingsPage() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState('');
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkingId, setCheckingId] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<Payment | null>(null);
  const [downloadingId, setDownloadingId] = useState('');

  async function loadBilling() {
    setLoading(true);
    setError('');
    try {
      const [currentResponse, paymentsResponse] = await Promise.all([
        crmApiFetch('/billing/current'),
        crmApiFetch('/billing/payments'),
      ]);
      const [currentPayload, paymentsPayload] = await Promise.all([currentResponse.json(), paymentsResponse.json()]);
      if (!currentResponse.ok) throw new Error(currentPayload?.error?.message ?? 'Could not load the current plan.');
      if (!paymentsResponse.ok) throw new Error(paymentsPayload?.error?.message ?? 'Could not load payment history.');
      const current = currentPayload.data;
      setPlans(Array.isArray(current.plans) ? current.plans as Plan[] : []);
      setPlan(current.plans?.find((item: Plan) => item.code === current.subscription?.planCode) ?? null);
      setStatus(current.subscription?.status ?? '');
      setEndsAt(current.subscription?.endsAt ?? null);
      setPayments(Array.isArray(paymentsPayload.data) ? paymentsPayload.data as Payment[] : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load workspace billing details.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadBilling(); }, []);

  async function checkPayment(transactionId: string) {
    setCheckingId(transactionId);
    setError('');
    try {
      const response = await crmApiFetch(`/billing/payment-status/${encodeURIComponent(transactionId)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not verify this payment.');
      await loadBilling();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not verify this payment.');
    } finally {
      setCheckingId('');
    }
  }

  function receiptNumber(payment: Payment) {
    return `LP-${payment.transactionId.slice(-10).toUpperCase()}`;
  }

  function planNameFor(payment: Payment) {
    return plans.find((item) => item.code === payment.planCode)?.name ?? payment.planCode;
  }

  async function downloadReceipt(payment: Payment) {
    setDownloadingId(payment.id);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1240;
      canvas.height = 1754;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the receipt for download.');

      context.fillStyle = '#f4f5fb';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.fillRect(42, 42, 1156, 1670);
      context.fillStyle = '#17176f';
      context.font = '700 44px Arial';
      context.fillText('SUBSCRIPTION RECEIPT', 82, 258);
      context.fillStyle = '#72758b';
      context.font = '22px Arial';
      context.fillText('PAYMENT CONFIRMED', 82, 302);
      context.textAlign = 'right';
      context.fillStyle = '#252844';
      context.font = '700 24px Arial';
      context.fillText(receiptNumber(payment), 1156, 112);
      context.textAlign = 'left';

      try {
        const logo = new Image();
        logo.src = '/leadpilot-advance-solution.svg';
        await logo.decode();
        context.drawImage(logo, 82, 76, 370, 84);
      } catch { /* Keep the LeadPilot wordmark if the logo cannot be loaded. */ }

      const drawLabelValue = (label: string, value: string, x: number, y: number) => {
        context.fillStyle = '#777a91';
        context.font = '700 17px Arial';
        context.fillText(label.toUpperCase(), x, y);
        context.fillStyle = '#282a42';
        context.font = '22px Arial';
        context.fillText(value.slice(0, 54), x, y + 38);
      };
      const paidDate = new Date(payment.verifiedAt ?? payment.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      drawLabelValue('Billed to', `${payment.customerName} · ${payment.customerEmail}`, 82, 388);
      drawLabelValue('Workspace', payment.organizationName, 82, 494);
      drawLabelValue('Paid on', paidDate, 650, 388);
      drawLabelValue('Payment status', 'Verified', 650, 494);

      context.fillStyle = '#f2f3fa';
      context.fillRect(82, 605, 1074, 66);
      context.fillStyle = '#4a4d64';
      context.font = '700 17px Arial';
      context.fillText('DESCRIPTION', 104, 647);
      context.textAlign = 'right';
      context.fillText('AMOUNT', 1134, 647);
      context.textAlign = 'left';
      context.fillStyle = '#262941';
      context.font = '24px Arial';
      const purchaseLabel = payment.paymentType === 'trial' ? 'Paid trial access' : payment.paymentType === 'renewal' ? 'Subscription renewal' : 'Subscription plan purchase / upgrade';
      context.fillText(`${planNameFor(payment)} · ${purchaseLabel}`.slice(0, 70), 104, 725);
      context.textAlign = 'right';
      context.font = '700 24px Arial';
      const amountText = `${payment.currency} ${Number(payment.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      context.fillText(amountText, 1134, 725);
      context.textAlign = 'left';
      context.strokeStyle = '#dedfed';
      context.lineWidth = 2;
      context.beginPath(); context.moveTo(82, 774); context.lineTo(1156, 774); context.stroke();

      context.fillStyle = '#777a91';
      context.font = '20px Arial';
      context.fillText('Total paid', 800, 840);
      context.textAlign = 'right';
      context.fillStyle = '#17176f';
      context.font = '700 34px Arial';
      context.fillText(amountText, 1134, 844);
      context.textAlign = 'left';
      context.fillStyle = '#777a91';
      context.font = '18px Arial';
      context.fillText('Payment reference', 82, 964);
      context.fillStyle = '#282a42';
      context.font = '20px Arial';
      context.fillText(`Transaction: ${payment.transactionId}`, 82, 1004);
      if (payment.payuId) context.fillText(`PayU reference: ${payment.payuId}`, 82, 1040);
      else if (payment.bankReference) context.fillText(`Bank reference: ${payment.bankReference}`, 82, 1040);

      context.fillStyle = '#f7f7fb';
      context.fillRect(82, 1140, 1074, 126);
      context.fillStyle = '#666a82';
      context.font = '18px Arial';
      context.fillText('This receipt confirms a verified subscription payment for LeadPilot.', 104, 1190);
      context.fillText('Thank you for choosing LeadPilot. Keep this receipt for your records.', 104, 1230);

      context.strokeStyle = '#dedfed';
      context.beginPath(); context.moveTo(82, 1398); context.lineTo(1156, 1398); context.stroke();
      try {
        const footerLogo = new Image();
        footerLogo.src = '/advance-solution-receipt.svg';
        await footerLogo.decode();
        context.drawImage(footerLogo, 360, 1460, 520, 174);
      } catch { /* Keep the receipt complete if the optional footer artwork cannot load. */ }

      const jpeg = canvas.toDataURL('image/jpeg', 0.94).split(',')[1];
      if (!jpeg) throw new Error('Could not generate a PDF receipt.');
      const imageBytes = Uint8Array.from(atob(jpeg), (character) => character.charCodeAt(0));
      const encoder = new TextEncoder();
      const pdfParts: Uint8Array[] = [];
      let byteOffset = 0;
      const offsets: number[] = [0];
      const append = (bytes: Uint8Array) => { pdfParts.push(bytes); byteOffset += bytes.length; };
      const appendText = (text: string) => append(encoder.encode(text));
      appendText('%PDF-1.4\n%LeadPilot receipt\n');
      const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Receipt 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
      ];
      for (const object of objects) { offsets.push(byteOffset); appendText(object); }
      offsets.push(byteOffset);
      appendText(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`);
      append(imageBytes);
      appendText('\nendstream\nendobj\n');
      offsets.push(byteOffset);
      const pageContent = 'q\n595 0 0 842 0 0 cm\n/Receipt Do\nQ\n';
      appendText(`5 0 obj\n<< /Length ${pageContent.length} >>\nstream\n${pageContent}endstream\nendobj\n`);
      const xrefOffset = byteOffset;
      appendText(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
      const blob = new Blob(pdfParts as BlobPart[], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `LeadPilot-receipt-${receiptNumber(payment)}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not download the receipt.');
    } finally {
      setDownloadingId('');
    }
  }

  return <main className="settings-route-content settings-billing-page">
    <header className="settings-billing-heading"><div><p className="date-label">WORKSPACE / BILLING</p><h2>Plan &amp; payment history</h2><p>Review the current subscription and every payment made by this workspace.</p></div><button className="button button-secondary" type="button" onClick={() => void loadBilling()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></header>
    {error && <p className="settings-access-state settings-access-error" role="alert">{error}</p>}
    <section className="panel settings-billing-current" aria-labelledby="settings-billing-current-title">
      <div><span className="auth-step">CURRENT WORKSPACE PLAN</span><h3 id="settings-billing-current-title">{loading ? 'Loading…' : plan?.name ?? 'No active plan'}</h3></div>
      <strong className="status-pill">{status || 'unknown'}</strong>
      {plan && <p><b>{plan.currency} {plan.monthlyPrice.toLocaleString('en-IN')} / {billingIntervalLabel(plan.billingInterval)}</b>{endsAt && <> · Expires {new Date(endsAt).toLocaleDateString()}</>}</p>}
      <a className="button button-primary" href="/subscription">Manage subscription</a>
    </section>
    <section className="subscription-payment-history" aria-labelledby="settings-payment-history-title">
      <header><div><span className="auth-step">WORKSPACE BILLING</span><h2 id="settings-payment-history-title">Purchases &amp; payments</h2><p>Payment records belong to this workspace only.</p></div></header>
      {!loading && payments.length === 0 && <p className="subscription-history-empty">No plan purchases or subscription payments have been recorded yet.</p>}
      <div className="subscription-payment-list">{payments.map((payment) => {
        const paymentPlan = plans.find((item) => item.code === payment.planCode)?.name ?? payment.planCode;
        const paymentStatus = payment.status.toLowerCase();
        const label = paymentStatus === 'succeeded' ? 'Verified' : paymentStatus === 'pending' ? 'Pending verification' : paymentStatus;
        return <article className="subscription-payment-item" key={payment.id}>
          <div className="subscription-payment-item-main"><strong>{paymentPlan}</strong><span>{payment.paymentType === 'trial' ? 'Paid trial' : payment.paymentType === 'renewal' ? 'Renewal' : 'Plan purchase / upgrade'} · {new Date(payment.createdAt).toLocaleString()}</span></div>
          <div className="subscription-payment-item-amount"><strong>{payment.currency} {Number(payment.amount).toLocaleString('en-IN')}</strong><span className={`subscription-payment-history-status is-${paymentStatus}`}>{label}</span></div>
          {(payment.payuId || payment.bankReference) && <small>Payment reference: {payment.payuId ?? payment.bankReference}</small>}
          {payment.failureReason && <p className="subscription-checkout-error">{payment.failureReason}</p>}
          {paymentStatus === 'pending' && <button className="button button-secondary" type="button" disabled={Boolean(checkingId)} onClick={() => void checkPayment(payment.transactionId)}>{checkingId === payment.transactionId ? 'Checking…' : 'Check payment'}</button>}
          {paymentStatus === 'succeeded' && <div className="settings-payment-receipt-actions"><button className="button button-secondary" type="button" onClick={() => setSelectedReceipt(payment)}>View receipt</button><button className="button button-primary" type="button" disabled={downloadingId === payment.id} onClick={() => void downloadReceipt(payment)}>{downloadingId === payment.id ? 'Preparing PDF…' : 'Download receipt'}</button></div>}
        </article>;
      })}</div>
    </section>
    {selectedReceipt && <div className="leadpilot-receipt-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedReceipt(null); }}>
      <section className="leadpilot-receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="leadpilot-receipt-title">
        <header className="leadpilot-receipt-topbar"><div className="leadpilot-receipt-brand"><img src="/leadpilot-advance-solution.svg" alt="LeadPilot by Advance Solution"/><span>Workspace billing</span></div><button type="button" className="button button-secondary" onClick={() => setSelectedReceipt(null)} aria-label="Close receipt">Close</button></header>
        <div className="leadpilot-receipt-heading"><div><span className="auth-step">PAYMENT RECEIPT</span><h2 id="leadpilot-receipt-title">{receiptNumber(selectedReceipt)}</h2></div><span className="subscription-payment-history-status is-succeeded">Paid · Verified</span></div>
        <div className="leadpilot-receipt-meta"><div><span>Billed to</span><strong>{selectedReceipt.customerName}</strong><small>{selectedReceipt.customerEmail}</small></div><div><span>Workspace</span><strong>{selectedReceipt.organizationName}</strong></div><div><span>Paid on</span><strong>{new Date(selectedReceipt.verifiedAt ?? selectedReceipt.createdAt).toLocaleString()}</strong></div></div>
        <div className="leadpilot-receipt-line"><div><strong>{planNameFor(selectedReceipt)}</strong><span>{selectedReceipt.paymentType === 'trial' ? 'Paid trial access' : selectedReceipt.paymentType === 'renewal' ? 'Subscription renewal' : 'Subscription plan purchase / upgrade'}</span></div><strong>{selectedReceipt.currency} {Number(selectedReceipt.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
        <div className="leadpilot-receipt-total"><span>Total paid</span><strong>{selectedReceipt.currency} {Number(selectedReceipt.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
        <div className="leadpilot-receipt-reference">
          <span>Transaction ID</span><code>{selectedReceipt.transactionId}</code>
          {selectedReceipt.payuId && <><span>PayU payment reference</span><code>{selectedReceipt.payuId}</code></>}
          {selectedReceipt.bankReference && <><span>Bank reference</span><code>{selectedReceipt.bankReference}</code></>}
        </div>
        <p className="leadpilot-receipt-note">This receipt confirms a verified subscription payment for LeadPilot. Keep it for your records.</p>
        <footer><button type="button" className="button button-secondary" onClick={() => setSelectedReceipt(null)}>Close</button><button type="button" className="button button-primary" disabled={downloadingId === selectedReceipt.id} onClick={() => void downloadReceipt(selectedReceipt)}>{downloadingId === selectedReceipt.id ? 'Preparing PDF…' : 'Download PDF receipt'}</button></footer>
      </section>
    </div>}
  </main>;
}
