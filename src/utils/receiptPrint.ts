import type { AppLang, Order, ShopSettings } from '../types';

const escapeHtml = (str: unknown): string =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function buildReceiptPrintHtml(order: Order, shopSettings: ShopSettings, lang: AppLang): string {
  const isEn = lang === 'en';
  const cust = order.customer || { name: '-', phone: '-' };
  const khrTotal = Math.round(Number(order.grandTotal || 0) * (shopSettings.khqrKhrRate || 4100));
  return `
    <div style="font-family: 'JetBrains Mono', 'Kantumruy Pro', monospace, sans-serif; font-size: 12px; color: #0f172a; max-width: 78mm; margin: 0 auto; padding: 8px; background: #fff;">
      <h3 style="margin: 0; text-align: center; font-size: 16px; font-weight: 800;">${escapeHtml(shopSettings.brandTitle)}</h3>
      ${shopSettings.phoneHotline ? `<p style="text-align: center; font-size: 11px; margin: 2px 0 0;">Tel: ${escapeHtml(shopSettings.phoneHotline)}</p>` : ''}
      <p style="text-align: center; font-size: 11px; margin: 3px 0 6px; color: #475569;">${escapeHtml(order.id)} · ${escapeHtml(order.timestamp)}</p>
      <hr style="border: 0; border-top: 1px dashed #64748b; margin: 8px 0;" />
      <p style="margin: 0; line-height: 1.45;">
        ${
          order.type === 'dinein'
            ? `<strong>${isEn ? 'TABLE' : 'តុលេខ'} #${escapeHtml(cust.tableNum || 1)}</strong>`
            : `<strong>${isEn ? 'DELIVERY' : 'ដឹកជញ្ជូន'}${cust.distanceKm ? ` (${escapeHtml(cust.distanceKm)} km)` : ''}</strong><br/>${escapeHtml(cust.addressName || '')}`
        }
        <br/>${isEn ? 'Customer' : 'ភ្ញៀវ'}: ${escapeHtml(cust.name || '-')}${cust.phone ? ` (${escapeHtml(cust.phone)})` : ''}
      </p>
      ${cust.addressNote ? `<p style="font-size: 11px; background: #f1f5f9; padding: 4px 6px; margin: 6px 0 0; border-radius: 4px;">Note: ${escapeHtml(cust.addressNote)}</p>` : ''}
      <hr style="border: 0; border-top: 1px dashed #64748b; margin: 8px 0;" />
      ${(order.items || [])
        .map(
          (i) => `
          <div style="display: flex; justify-content: space-between; gap: 8px; margin-bottom: 5px;">
            <span>${i.qty}x ${escapeHtml(i.name)}<br/><small style="color: #475569;">${escapeHtml(i.options)}</small></span>
            <span style="font-weight: 700; white-space: nowrap;">$${(Number(i.unitPrice || 0) * Number(i.qty || 1)).toFixed(2)}</span>
          </div>`
        )
        .join('')}
      <hr style="border: 0; border-top: 1px dashed #64748b; margin: 8px 0;" />
      <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
        <span>${isEn ? 'Subtotal' : 'សរុបទំនិញ'}</span>
        <span>$${Number(order.subtotal ?? order.grandTotal ?? 0).toFixed(2)}</span>
      </div>
      ${
        Number(order.promoDisc || 0) > 0
          ? `<div style="display: flex; justify-content: space-between; margin-bottom: 3px; color: #b91c1c;">
              <span>Promo</span>
              <span>-$${Number(order.promoDisc).toFixed(2)}</span>
            </div>`
          : ''
      }
      ${
        order.type === 'delivery'
          ? `<div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
              <span>${isEn ? 'Delivery' : 'ថ្លៃដឹក'}</span>
              <span>$${Number(order.fee || 0).toFixed(2)}</span>
            </div>`
          : ''
      }
      <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 14px; border-top: 1px solid #cbd5e1; padding-top: 5px; margin-top: 4px;">
        <span>${isEn ? 'TOTAL' : 'សរុប'}</span>
        <span>$${Number(order.grandTotal || 0).toFixed(2)}</span>
      </div>
      <div style="text-align: right; font-size: 10px; color: #475569; margin-top: 2px;">~ ${khrTotal.toLocaleString('en-US')} KHR</div>
      <div style="text-align: center; border: 1.5px solid #0f172a; padding: 5px; margin-top: 10px; font-weight: 800;">
        ${order.paymentVerified ? `✓ PAID (${escapeHtml(order.payment)})` : `UNPAID · ${escapeHtml(order.payment)}`}
      </div>
      <p style="text-align: center; font-size: 10px; margin-top: 8px; color: #475569;">${isEn ? 'Thank you!' : 'សូមអរគុណ!'}</p>
    </div>
  `;
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export function renderReceiptToDataUrl(
  order: Order,
  shopSettings: ShopSettings,
  lang: AppLang
): string {
  const isEn = lang === 'en';
  const cust = order.customer || { name: '-', phone: '-' };
  const khrTotal = Math.round(Number(order.grandTotal || 0) * (shopSettings.khqrKhrRate || 4100));

  const W = 560;
  const padX = 34;
  const contentW = W - padX * 2;
  const items = order.items || [];

  // Pre-measure height cleanly
  const probe = document.createElement('canvas').getContext('2d');
  let estHeight = 320;
  if (probe) {
    probe.font = 'bold 20px "Kantumruy Pro", "Plus Jakarta Sans", sans-serif';
    for (const item of items) {
      const titleLines = wrapTextLines(probe, `${item.qty}x ${item.name}`, contentW - 110);
      estHeight += titleLines.length * 26;
      if (item.options) {
        probe.font = '15px "Kantumruy Pro", "Plus Jakarta Sans", sans-serif';
        const optLines = wrapTextLines(probe, item.options, contentW - 110);
        estHeight += optLines.length * 21;
        probe.font = 'bold 20px "Kantumruy Pro", "Plus Jakarta Sans", sans-serif';
      }
      estHeight += 14;
    }
    if (order.type === 'delivery' && cust.addressName) estHeight += 42;
    if (cust.addressNote) estHeight += 36;
  } else {
    estHeight += items.length * 64;
  }
  const H = Math.max(520, estHeight + 170);

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return '';

  // Paper background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Subtle top accent bar
  ctx.fillStyle = '#0D4A3E';
  ctx.fillRect(0, 0, W, 12);

  let y = 52;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0D4A3E';
  ctx.font = 'bold 28px "Plus Jakarta Sans", "Kantumruy Pro", sans-serif';
  ctx.fillText(String(shopSettings.brandTitle || 'Coffee Shop').slice(0, 32), W / 2, y);
  y += 26;

  if (shopSettings.phoneHotline) {
    ctx.fillStyle = '#475569';
    ctx.font = '16px "JetBrains Mono", monospace, sans-serif';
    ctx.fillText(`Tel: ${shopSettings.phoneHotline}`, W / 2, y);
    y += 22;
  }

  ctx.fillStyle = '#64748B';
  ctx.font = '15px "JetBrains Mono", monospace, sans-serif';
  ctx.fillText(`${order.id}  ·  ${order.timestamp}`, W / 2, y);
  y += 20;

  const drawDash = () => {
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(W - padX, y);
    ctx.stroke();
    ctx.setLineDash([]);
    y += 26;
  };

  drawDash();

  // Customer / Table block
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 19px "Kantumruy Pro", "Plus Jakarta Sans", sans-serif';
  if (order.type === 'dinein') {
    ctx.fillText(`${isEn ? 'Dine-In · Table' : 'ញ៉ាំនៅហាង · តុលេខ'} #${cust.tableNum || 1}`, padX, y);
    y += 25;
  } else {
    ctx.fillText(
      `${isEn ? 'Delivery' : 'ដឹកជញ្ជូន'}${cust.distanceKm ? ` (${cust.distanceKm} km)` : ''}`,
      padX,
      y
    );
    y += 24;
    if (cust.addressName) {
      ctx.fillStyle = '#334155';
      ctx.font = '15px "Kantumruy Pro", "Plus Jakarta Sans", sans-serif';
      for (const ln of wrapTextLines(ctx, cust.addressName, contentW).slice(0, 2)) {
        ctx.fillText(ln, padX, y);
        y += 20;
      }
    }
  }

  ctx.fillStyle = '#334155';
  ctx.font = '16px "Kantumruy Pro", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    `${isEn ? 'Customer' : 'ភ្ញៀវ'}: ${cust.name || '-'}${cust.phone ? ` (${cust.phone})` : ''}`,
    padX,
    y
  );
  y += 22;

  if (cust.addressNote) {
    ctx.fillStyle = '#475569';
    ctx.font = '14px "Kantumruy Pro", "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`Note: ${String(cust.addressNote).slice(0, 52)}`, padX, y);
    y += 20;
  }

  y += 4;
  drawDash();

  // Order Items
  for (const item of items) {
    const linePrice = `$${(Number(item.unitPrice || 0) * Number(item.qty || 1)).toFixed(2)}`;
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 19px "Kantumruy Pro", "Plus Jakarta Sans", sans-serif';
    const titleLines = wrapTextLines(ctx, `${item.qty}x ${item.name}`, contentW - 110);
    titleLines.forEach((ln, idx) => {
      ctx.textAlign = 'left';
      ctx.fillText(ln, padX, y);
      if (idx === 0) {
        ctx.textAlign = 'right';
        ctx.font = 'bold 19px "JetBrains Mono", monospace';
        ctx.fillText(linePrice, W - padX, y);
        ctx.font = 'bold 19px "Kantumruy Pro", "Plus Jakarta Sans", sans-serif';
      }
      y += 25;
    });
    if (item.options) {
      ctx.fillStyle = '#64748B';
      ctx.textAlign = 'left';
      ctx.font = '15px "Kantumruy Pro", "Plus Jakarta Sans", sans-serif';
      for (const oln of wrapTextLines(ctx, item.options, contentW - 100).slice(0, 2)) {
        ctx.fillText(oln, padX + 16, y);
        y += 20;
      }
    }
    y += 8;
  }

  drawDash();

  // Totals
  const drawTotalRow = (label: string, val: string, color = '#334155', bold = false) => {
    ctx.fillStyle = color;
    ctx.font = `${bold ? 'bold 23px' : '17px'} "Kantumruy Pro", "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(label, padX, y);
    ctx.font = `${bold ? 'bold 24px' : 'bold 17px'} "JetBrains Mono", monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(val, W - padX, y);
    y += bold ? 30 : 25;
  };

  drawTotalRow(
    isEn ? 'Subtotal' : 'សរុបទំនិញ',
    `$${Number(order.subtotal ?? order.grandTotal ?? 0).toFixed(2)}`
  );
  if (Number(order.promoDisc || 0) > 0) {
    drawTotalRow('Promo', `-$${Number(order.promoDisc).toFixed(2)}`, '#DC2626');
  }
  if (order.type === 'delivery') {
    drawTotalRow(isEn ? 'Delivery Fee' : 'ថ្លៃដឹកជញ្ជូន', `$${Number(order.fee || 0).toFixed(2)}`);
  }

  y += 6;
  drawTotalRow(
    `${isEn ? 'TOTAL' : 'សរុប'} (${order.payment})`,
    `$${Number(order.grandTotal || 0).toFixed(2)}`,
    '#0D4A3E',
    true
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#64748B';
  ctx.font = '15px "JetBrains Mono", monospace';
  ctx.fillText(`~ ${khrTotal.toLocaleString('en-US')} KHR`, W - padX, y);
  y += 28;

  // Paid / Unpaid stamp box
  ctx.strokeStyle = order.paymentVerified ? '#059669' : '#D97706';
  ctx.fillStyle = order.paymentVerified ? '#ECFDF5' : '#FFFBEB';
  ctx.lineWidth = 2;
  ctx.fillRect(padX, y, contentW, 46);
  ctx.strokeRect(padX, y, contentW, 46);
  ctx.fillStyle = order.paymentVerified ? '#047857' : '#B45309';
  ctx.textAlign = 'center';
  ctx.font = 'bold 18px "JetBrains Mono", "Kantumruy Pro", sans-serif';
  ctx.fillText(
    order.paymentVerified ? `✓ PAID · ${order.payment}` : `UNPAID · ${order.payment}`,
    W / 2,
    y + 30
  );
  y += 74;

  ctx.fillStyle = '#64748B';
  ctx.font = '15px "Kantumruy Pro", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(isEn ? 'Thank you for your order!' : 'សូមអរគុណសម្រាប់ការកម្ម៉ង់!', W / 2, y);

  // Crop excess blank height so receipt PNG has snug bottom margin
  const finalH = Math.min(H, y + 36);
  if (finalH < H - 10) {
    const out = document.createElement('canvas');
    out.width = W;
    out.height = finalH;
    const octx = out.getContext('2d');
    if (octx) {
      octx.drawImage(c, 0, 0, W, finalH, 0, 0, W, finalH);
      return out.toDataURL('image/png');
    }
  }
  return c.toDataURL('image/png');
}

function isRestrictedInAppWebView(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const hasTgProxy = Boolean((window as unknown as Record<string, unknown>).TelegramWebviewProxy);
  if (hasTgProxy || /Telegram|FBAN|FBAV|Instagram|Line\//i.test(ua)) return true;
  // Cross-origin embedded iframe (e.g. AI Studio preview) often restricts print dialogs
  try {
    if (window.self !== window.top) {
      // Accessing parent location throws if cross-origin
      void window.parent.location.href;
    }
  } catch {
    return true;
  }
  return false;
}

export async function saveOrShareReceiptPng(
  order: Order,
  shopSettings: ShopSettings,
  lang: AppLang
): Promise<{ method: 'share' | 'download' | 'preview'; dataUrl: string }> {
  const dataUrl = renderReceiptToDataUrl(order, shopSettings, lang);
  if (!dataUrl) {
    return { method: 'preview', dataUrl: '' };
  }

  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const fileName = `Receipt-${order.id}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };
    if (typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
      await nav.share({
        files: [file],
        title: `${shopSettings.brandTitle} · ${order.id}`,
      });
      return { method: 'share', dataUrl };
    }
  } catch (err) {
    // User cancelled share sheet OR WebView blocked share -> still allow download/preview below
    if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
      return { method: 'share', dataUrl };
    }
  }

  if (!isRestrictedInAppWebView()) {
    try {
      const a = document.createElement('a');
      a.download = `Receipt-${order.id}.png`;
      a.href = dataUrl;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return { method: 'download', dataUrl };
    } catch {
      // fall through to preview
    }
  }

  return { method: 'preview', dataUrl };
}

export async function printReceiptDocument(
  order: Order,
  shopSettings: ShopSettings,
  lang: AppLang
): Promise<{ printed: boolean; fallbackDataUrl?: string }> {
  const restricted = isRestrictedInAppWebView();
  const dataUrl = renderReceiptToDataUrl(order, shopSettings, lang);

  if (restricted) {
    return { printed: false, fallbackDataUrl: dataUrl };
  }

  // Render an explicit main-document @media print receipt node so mobile Safari / Chrome prints cleanly
  // (0x0 hidden iframes fail silently on iOS Safari and many mobile browsers).
  let root = document.getElementById('app-print-receipt-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'app-print-receipt-root';
    document.body.appendChild(root);
  }
  root.innerHTML = buildReceiptPrintHtml(order, shopSettings, lang);
  document.documentElement.classList.add('printing-receipt-mode');

  let printObserved = false;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.documentElement.classList.remove('printing-receipt-mode');
    window.removeEventListener('afterprint', onAfterPrint);
  };
  const onAfterPrint = () => {
    printObserved = true;
    cleanup();
  };
  window.addEventListener('afterprint', onAfterPrint);

  const mql = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
  const onMql = (e: MediaQueryListEvent) => {
    if (e.matches) printObserved = true;
  };
  mql?.addEventListener?.('change', onMql);

  const startedAt = Date.now();
  try {
    window.focus?.();
    window.print();
  } catch {
    mql?.removeEventListener?.('change', onMql);
    cleanup();
    return { printed: false, fallbackDataUrl: dataUrl };
  }
  const elapsed = Date.now() - startedAt;

  // Desktop Chrome blocks synchronously in window.print(); iOS Safari opens AirPrint async and triggers matchMedia/blur.
  // If window.print() returned immediately (<40ms) with zero print media activation on mobile touch WebView, offer PNG fallback too.
  await new Promise((r) => setTimeout(r, 320));
  mql?.removeEventListener?.('change', onMql);

  // Keep print DOM intact up to 60s for slow iOS AirPrint sheets; clean up immediately if afterprint already fired.
  window.setTimeout(cleanup, 60000);

  if (printObserved || elapsed >= 120 || !('ontouchstart' in window)) {
    return { printed: true };
  }

  // On iOS Safari, window.print() returns in <50ms even when the AirPrint sheet DOES appear (it triggers window blur).
  // If document still has focus and never entered print media, expose fallback PNG preview gently as well.
  if (document.hasFocus()) {
    return { printed: false, fallbackDataUrl: dataUrl };
  }

  return { printed: true };
}
