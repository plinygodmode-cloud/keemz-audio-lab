/* Payment return page: asks the server for the verified order status.
   Nothing here marks an order as paid — only the signed Paymob callback can
   do that. The page reads the signed reference from the URL Paymob used. */
(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const params = new URLSearchParams(window.location.search);
  const ref = String(params.get('ref') || params.get('merchant_order_id') || '').trim();
  const token = String(params.get('t') || params.get('token') || '').trim();

  const card = $('#return-card');
  const mark = $('#return-mark');
  const eyebrow = $('#return-eyebrow');
  const title = $('#return-title');
  const message = $('#return-message');
  const details = $('#return-details');
  const status = $('#return-status');
  const resend = $('#resend-button');
  const note = $('#return-note');
  const copyright = $('#copyright');

  if (copyright) copyright.textContent = `© ${new Date().getFullYear()} Keemz Audio Lab`;

  const STATES = {
    paid: {
      mark: '✓',
      markClass: '',
      eyebrow: 'Payment confirmed',
      title: 'Your sounds are <em>ready.</em>',
      message:
        'The payment provider confirmed this order. Your private download links have been emailed to you and remain available for seven days.',
      note: 'Check your spam folder if the email has not arrived within a few minutes — then use the button above to request it again.'
    },
    processing: {
      mark: '↗',
      markClass: 'is-warn',
      eyebrow: 'Payment processing',
      title: 'Waiting on the <em>provider.</em>',
      message:
        'Your order is recorded but the payment provider has not sent a final confirmation yet. This can take a minute. The download email is sent automatically the moment it lands — you can safely close this page.',
      note: 'If the payment left your account and no email arrives within an hour, reply to your order confirmation or use the contact form.'
    },
    failed: {
      mark: '×',
      markClass: 'is-bad',
      eyebrow: 'Payment not completed',
      title: 'Nothing was <em>charged.</em>',
      message:
        'This order did not complete. No payment was taken and no files were released. You can return to the store and try again with another method.',
      note: 'If your bank shows a pending charge, it will normally be released automatically.'
    },
    refunded: {
      mark: '↺',
      markClass: 'is-warn',
      eyebrow: 'Order refunded',
      title: 'This order was <em>refunded.</em>',
      message:
        'A refund or void was recorded for this order, so its download links are no longer valid. Contact the studio if you believe this is a mistake.',
      note: ''
    },
    unknown: {
      mark: '?',
      markClass: 'is-warn',
      eyebrow: 'Order not found',
      title: 'We cannot find this <em>order.</em>',
      message:
        'The reference in this link does not match an order on the server. It may have expired, or the link may have been copied incompletely.',
      note: 'Open the payment-return link from your order email, or contact the studio with your Paymob transaction number.'
    },
    error: {
      mark: '!',
      markClass: 'is-bad',
      eyebrow: 'Status unavailable',
      title: 'Could not check the <em>status.</em>',
      message: 'The order service did not answer. Your payment is not affected — the server still receives the payment callback independently.',
      note: 'Refresh this page in a moment, or contact the studio if your download email does not arrive.'
    }
  };

  function setState(key) {
    const state = STATES[key] || STATES.error;
    mark.textContent = state.mark;
    mark.className = `page-mark ${state.markClass}`.trim();
    eyebrow.textContent = state.eyebrow;
    title.innerHTML = state.title;
    message.textContent = state.message;
    note.textContent = state.note;
    note.hidden = !state.note;
  }

  function renderDetails(order) {
    if (!details) return;
    const rows = [
      ['Reference', order.ref],
      ['Status', String(order.status || '').replace(/_/g, ' ')],
      ['Total', `${(Number(order.amount) / 100).toFixed(2)} ${order.currency || ''}`.trim()],
      ['Items', (order.items || []).map(item => `${item.name} × ${item.quantity}`).join(', ') || '—']
    ];
    details.innerHTML = rows
      .map(([label, value]) => {
        const cell = document.createElement('div');
        const key = document.createElement('span');
        const val = document.createElement('strong');
        key.textContent = label;
        val.textContent = value;
        cell.append(key, val);
        return cell.outerHTML;
      })
      .join('');
    details.hidden = false;
  }

  function clearCart() {
    try {
      window.localStorage.removeItem('kal-cart-v3');
    } catch {
      /* storage may be unavailable */
    }
  }

  function stateFromOrder(order) {
    if (!order) return 'unknown';
    if (order.status === 'paid') return 'paid';
    if (order.status === 'refunded' || order.status === 'voided') return 'refunded';
    if (order.status === 'failed' || order.status === 'cancelled' || order.status === 'delivery_failed') {
      return order.status === 'delivery_failed' ? 'processing' : 'failed';
    }
    return 'processing';
  }

  async function check() {
    if (!ref || !token) {
      setState('unknown');
      status.textContent = '';
      message.textContent =
        'This page was opened without a signed order reference. Open the return link exactly as the payment provider sent it, or use the link in your order email.';
      return;
    }

    try {
      const response = await fetch(`api/order-status?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(token)}`, {
        headers: { Accept: 'application/json' }
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 404) {
        setState('unknown');
        status.textContent = '';
        return;
      }
      if (!response.ok) throw new Error(data.error || `Status ${response.status}`);

      const key = stateFromOrder(data);
      setState(key);
      renderDetails(data);
      status.textContent = '';

      if (key === 'paid') {
        clearCart();
        resend.hidden = false;
        const when = data.paidAt ? new Date(data.paidAt).toLocaleString() : '';
        status.textContent = data.delivered
          ? `Delivery email sent${when ? ` · payment recorded ${when}` : ''}.`
          : 'Payment recorded. The delivery email is being sent now.';
        if (!data.delivered) {
          window.setTimeout(check, 6000);
        }
      }
    } catch (error) {
      setState('error');
      status.textContent = error.message || 'The order service did not answer.';
      status.classList.add('is-error');
    }
  }

  resend?.addEventListener('click', async () => {
    resend.disabled = true;
    const label = resend.querySelector('.button-label');
    const original = label ? label.textContent : 'Email the links again';
    if (label) label.textContent = 'Sending…';
    try {
      const response = await fetch('api/order-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ref, token })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The links could not be re-sent.');
      status.textContent = 'Sent. Check the inbox for the address used at checkout.';
      status.classList.remove('is-error');
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('is-error');
    } finally {
      resend.disabled = false;
      if (label) label.textContent = original;
    }
  });

  check();
})();
