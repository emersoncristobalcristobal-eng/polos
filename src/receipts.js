// Servicio de gestión de boletas de venta, numeración correlativa única y ciclo de impresión.

const { getOrder } = require('./queries');
const { buildEscPosBuffer, generateReceiptText, sendToWindowsPrinter, formatMoney } = require('./printer');
const util = require('./util');

// Obtiene la configuración de la tienda y la impresora almacenada en la base de datos
async function getSettings(db) {
  const rows = await db.all('SELECT key, value FROM settings');
  const defaults = {
    printer_name: '',
    printer_paper_width: '58mm',
    printer_auto_cut: '1',
    printer_auto_print: 'on_paid', // 'on_paid', 'on_order', 'disabled'
    store_business_name: 'POLOLAB PERÚ S.A.C.',
    store_ruc: '20608974512',
    store_address: 'Av. Larco 743, Miraflores, Lima',
    store_phone: '(01) 445-8920 / 992 481 029',
    receipt_series: 'B001',
  };

  const settings = { ...defaults };
  for (const r of rows) {
    settings[r.key] = r.value;
  }
  return settings;
}

// Guarda o actualiza configuraciones en la tabla settings
async function saveSettings(db, newSettings) {
  for (const [key, val] of Object.entries(newSettings)) {
    if (val !== undefined) {
      await db.run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        key,
        String(val),
      );
    }
  }
}

// Genera una boleta de venta única para un pedido
async function generateReceipt(db, orderId, { autoPrint = true, forceImmediatePrint = false } = {}) {
  const order = await getOrder(db, orderId);
  if (!order) {
    throw new util.HttpError(404, 'Pedido no encontrado para generar boleta');
  }

  // Prevenir duplicados: verificar si ya existe una boleta para este pedido
  let existing = await db.get('SELECT * FROM receipts WHERE order_id = ?', orderId);
  const settings = await getSettings(db);

  if (!existing) {
    // Si no existe, crear dentro de una transacción atómica para garantizar correlativo único
    existing = await db.tx(async (t) => {
      // Doble verificación dentro de la transacción
      const check = await t.get('SELECT * FROM receipts WHERE order_id = ?', orderId);
      if (check) return check;

      const series = settings.receipt_series || 'B001';
      // Obtener el último número correlativo para la serie
      const last = await t.get('SELECT COALESCE(MAX(correlative), 0) AS max_correlative FROM receipts WHERE series = ?', series);
      const nextCorrelative = (last?.max_correlative || 0) + 1;
      const receiptNumber = `${series}-${String(nextCorrelative).padStart(8, '0')}`;

      const { lastInsertRowid } = await t.run(
        `INSERT INTO receipts (
          order_id, receipt_number, series, correlative, customer_name,
          customer_phone, customer_doc, customer_city, customer_address,
          payment_method, subtotal, shipping, discount, total,
          print_status, print_attempts, printer_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        order.id,
        receiptNumber,
        series,
        nextCorrelative,
        order.ship_name || order.customer_name,
        order.ship_phone || '',
        order.ship_doc || '',
        order.ship_city || '',
        order.ship_address || '',
        order.payment_method,
        order.subtotal,
        order.shipping,
        0,
        order.total,
        'pendiente',
        0,
        settings.printer_name || '',
      );

      return await t.get('SELECT * FROM receipts WHERE id = ?', lastInsertRowid);
    });
  }

  // Verificación de reglas para impresión automática:
  // 1. Debe haber una impresora configurada.
  // 2. Si es 'on_paid', el pedido debe estar pagado (o forceImmediatePrint debe ser true).
  // 3. Si es 'on_order', se imprime al crear el pedido.
  const shouldPrint =
    autoPrint &&
    settings.printer_name &&
    (forceImmediatePrint ||
      (settings.printer_auto_print === 'on_paid' && (order.status === 'pagado' || order.status === 'entregado')) ||
      (settings.printer_auto_print === 'on_order' && order.status !== 'cancelado'));

  if (shouldPrint && existing.print_status !== 'impresa') {
    await printReceipt(db, existing.id);
    existing = await db.get('SELECT * FROM receipts WHERE id = ?', existing.id);
  }

  return attachReceiptDetails(existing, order, settings);
}

// Envía la boleta a la impresora física y registra el resultado en la base de datos
async function printReceipt(db, receiptId) {
  const receipt = await db.get('SELECT * FROM receipts WHERE id = ?', receiptId);
  if (!receipt) {
    throw new util.HttpError(404, 'Boleta no encontrada');
  }

  const order = await getOrder(db, receipt.order_id);
  const settings = await getSettings(db);
  const printerName = settings.printer_name;

  if (!printerName) {
    await db.run(
      `UPDATE receipts SET print_status = 'fallida', last_error = 'No hay ninguna impresora configurada en el sistema',
       print_attempts = print_attempts + 1 WHERE id = ?`,
      receiptId,
    );
    return { ok: false, error: 'No hay ninguna impresora configurada' };
  }

  const storeInfo = {
    name: settings.store_business_name,
    ruc: settings.store_ruc,
    address: settings.store_address,
    phone: settings.store_phone,
  };

  const width = settings.printer_paper_width || '58mm';
  const autoCut = settings.printer_auto_cut === '1';

  try {
    const buffer = buildEscPosBuffer(receipt, order, { width, autoCut, storeInfo });
    await sendToWindowsPrinter(printerName, buffer, `Boleta ${receipt.receipt_number}`);

    await db.run(
      `UPDATE receipts SET print_status = 'impresa', printed_at = datetime('now'),
       print_attempts = print_attempts + 1, printer_name = ?, last_error = '' WHERE id = ?`,
      printerName,
      receiptId,
    );

    return { ok: true, message: `Boleta ${receipt.receipt_number} impresa correctamente en '${printerName}'` };
  } catch (err) {
    const errorMsg = err.message || 'Error desconocido al imprimir';
    await db.run(
      `UPDATE receipts SET print_status = 'fallida', last_error = ?,
       print_attempts = print_attempts + 1, printer_name = ? WHERE id = ?`,
      errorMsg,
      printerName,
      receiptId,
    );
    return { ok: false, error: errorMsg };
  }
}

// Agrega metadatos, textos formateados y vista previa HTML para la visualización
function attachReceiptDetails(receipt, order, settings) {
  const storeInfo = {
    name: settings.store_business_name,
    ruc: settings.store_ruc,
    address: settings.store_address,
    phone: settings.store_phone,
  };

  const rawText = generateReceiptText(receipt, order, {
    width: settings.printer_paper_width || '58mm',
    storeInfo,
  });

  const paymentLabels = {
    yape: 'Yape / Plin',
    transferencia: 'Transferencia bancaria',
    contraentrega: 'Pago contra entrega',
  };

  const previewHtml = generateHtmlReceipt(receipt, order, settings);

  return {
    ...receipt,
    payment_method_label: paymentLabels[receipt.payment_method] || receipt.payment_method,
    order,
    raw_text: rawText,
    preview_html: previewHtml,
  };
}

// Genera HTML optimizado para vista previa y para impresión con window.print()
function generateHtmlReceipt(receipt, order, settings) {
  const items = order?.items || [];
  const widthClass = settings.printer_paper_width === '80mm' ? 'thermal-80' : 'thermal-58';
  const widthMm = settings.printer_paper_width === '80mm' ? '80mm' : '58mm';

  const paymentLabels = {
    yape: 'Yape / Plin',
    transferencia: 'Transferencia bancaria',
    contraentrega: 'Pago contra entrega',
  };

  return `
    <div class="thermal-receipt ${widthClass}" data-receipt-print style="max-width: ${widthMm};">
      <div class="tr-header">
        <div class="tr-brand">${escapeHtml(settings.store_business_name)}</div>
        <div class="tr-sub">R.U.C. ${escapeHtml(settings.store_ruc)}</div>
        <div class="tr-sub">${escapeHtml(settings.store_address)}</div>
        <div class="tr-sub">${escapeHtml(settings.store_phone)}</div>
      </div>

      <div class="tr-divider">================================</div>
      <div class="tr-title">BOLETA DE VENTA ELECTRÓNICA</div>
      <div class="tr-num">${escapeHtml(receipt.receipt_number)}</div>
      <div class="tr-divider">--------------------------------</div>

      <div class="tr-info">
        <div><strong>Fecha:</strong> ${escapeHtml(receipt.issue_date || '')}</div>
        <div><strong>Cliente:</strong> ${escapeHtml(receipt.customer_name)}</div>
        ${receipt.customer_phone ? `<div><strong>Teléfono:</strong> ${escapeHtml(receipt.customer_phone)}</div>` : ''}
        ${receipt.customer_address ? `<div><strong>Dirección:</strong> ${escapeHtml(receipt.customer_address)}, ${escapeHtml(receipt.customer_city)}</div>` : ''}
        <div><strong>Pago:</strong> ${escapeHtml(paymentLabels[receipt.payment_method] || receipt.payment_method)}</div>
        <div><strong>Estado:</strong> ${order?.status === 'pagado' || order?.status === 'entregado' ? 'PAGADO / CONFIRMADO' : 'PENDIENTE DE PAGO'}</div>
      </div>

      <div class="tr-divider">--------------------------------</div>

      <table class="tr-table">
        <thead>
          <tr>
            <th class="tr-col-qty">Cant</th>
            <th class="tr-col-desc">Descripción</th>
            <th class="tr-col-price">Total</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (it) => `
            <tr>
              <td class="tr-col-qty">${it.quantity}x</td>
              <td class="tr-col-desc">
                ${escapeHtml(it.product_name)} (${escapeHtml(it.size)})
                ${it.custom_text ? `<br><small>Estampado: "${escapeHtml(it.custom_text)}"</small>` : ''}
              </td>
              <td class="tr-col-price">${formatMoney(it.unit_price * it.quantity)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>

      <div class="tr-divider">--------------------------------</div>

      <div class="tr-totals">
        <div class="tr-row"><span>Subtotal:</span><span>${formatMoney(receipt.subtotal)}</span></div>
        <div class="tr-row"><span>Envío:</span><span>${receipt.shipping > 0 ? formatMoney(receipt.shipping) : 'GRATIS'}</span></div>
        ${receipt.discount > 0 ? `<div class="tr-row"><span>Descuento:</span><span>-${formatMoney(receipt.discount)}</span></div>` : ''}
        <div class="tr-divider">================================</div>
        <div class="tr-row tr-total"><strong>TOTAL:</strong><strong>${formatMoney(receipt.total)}</strong></div>
        <div class="tr-divider">================================</div>
      </div>

      <div class="tr-footer">
        <p>¡GRACIAS POR TU COMPRA!</p>
        <small>POLOLAB · Diseñado en la calle</small>
        <small>Hecho en Perú</small>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  getSettings,
  saveSettings,
  generateReceipt,
  printReceipt,
  attachReceiptDetails,
  generateHtmlReceipt,
};
