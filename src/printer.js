// Sistema de impresión para impresoras térmicas (58 mm y 80 mm) y Windows Print Spooler.
// Compatible con ESC/POS directo, spooler de Windows y vista previa web.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Comandos ESC/POS estándar
const ESC = '\x1b';
const GS = '\x1d';

const COMMANDS = {
  INIT: Buffer.from([0x1b, 0x40]), // ESC @
  ALIGN_LEFT: Buffer.from([0x1b, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([0x1b, 0x61, 0x01]),
  ALIGN_RIGHT: Buffer.from([0x1b, 0x61, 0x02]),
  BOLD_ON: Buffer.from([0x1b, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([0x1b, 0x45, 0x00]),
  DOUBLE_HEIGHT_ON: Buffer.from([0x1b, 0x21, 0x10]),
  DOUBLE_WIDTH_ON: Buffer.from([0x1b, 0x21, 0x20]),
  DOUBLE_SIZE_ON: Buffer.from([0x1b, 0x21, 0x30]),
  TEXT_NORMAL: Buffer.from([0x1b, 0x21, 0x00]),
  FEED_LINES: (n = 3) => Buffer.from([0x1b, 0x64, n]),
  CUT_FULL: Buffer.from([0x1d, 0x56, 0x00]), // GS V 0
  CUT_PARTIAL: Buffer.from([0x1d, 0x56, 0x01]), // GS V 1
  DRAWER_PULSE: Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]), // ESC p 0 25 250
};

// Script PowerShell que usa la API nativa winspool.drv (RawPrinterHelper) para enviar bytes RAW a cualquier impresora de Windows
const RAW_PRINTER_PS_SCRIPT = `
param (
    [string]$PrinterName,
    [string]$FilePath,
    [string]$DocName = "Boleta de Venta"
)

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendFileToPrinter(string szPrinterName, string szFileName, string docName) {
        if (!File.Exists(szFileName)) return false;
        byte[] bytes = File.ReadAllBytes(szFileName);

        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = docName;
        di.pDataType = "RAW";

        if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            int err = Marshal.GetLastWin32Error();
            throw new Exception("No se pudo abrir la impresora '" + szPrinterName + "'. Error Win32: " + err);
        }

        bool success = false;
        try {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int written = 0;
                    success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
        return success;
    }
}
"@

try {
    $ok = [RawPrinterHelper]::SendFileToPrinter($PrinterName, $FilePath, $DocName)
    if ($ok) {
        Write-Output "SUCCESS"
        exit 0
    } else {
        Write-Error "Fallo al escribir en la impresora"
        exit 1
    }
} catch {
    Write-Error $_.Exception.Message
    exit 2
}
`;

// Lista las impresoras disponibles en el sistema operativo Windows
async function listPrinters() {
  if (process.platform !== 'win32') {
    return [{ name: 'Impresora Virtual (Simulador)', isDefault: true, status: 'Listo' }];
  }

  const psCommand = `Get-Printer | Select-Object Name, Type, DriverName, PortName, PrinterStatus, Default | ConvertTo-Json -Compress`;

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
      { timeout: 8000 },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          return resolve([{ name: 'Microsoft Print to PDF', isDefault: true, status: 'Disponible' }]);
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          const list = Array.isArray(parsed) ? parsed : [parsed];
          const result = list.map((p) => ({
            name: p.Name,
            isDefault: Boolean(p.Default),
            type: p.Type || 'Local',
            driver: p.DriverName || '',
            port: p.PortName || '',
            status: p.PrinterStatus === 0 ? 'Listo' : 'Disponible',
          }));
          resolve(result);
        } catch {
          resolve([{ name: 'Microsoft Print to PDF', isDefault: true, status: 'Disponible' }]);
        }
      },
    );
  });
}

// Formatea texto para un ancho fijo con caracteres (32 para 58 mm, 48 para 80 mm)
function padRight(str, len) {
  const s = String(str || '');
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function padLeft(str, len) {
  const s = String(str || '');
  return s.length >= len ? s.slice(0, len) : ' '.repeat(len - s.length) + s;
}

function center(str, len) {
  const s = String(str || '').trim();
  if (s.length >= len) return s.slice(0, len);
  const left = Math.floor((len - s.length) / 2);
  const right = len - s.length - left;
  return ' '.repeat(left) + s + ' '.repeat(right);
}

function line(len, char = '-') {
  return char.repeat(len);
}

function formatMoney(cents) {
  return `S/ ${(Number(cents || 0) / 100).toFixed(2)}`;
}

// Genera el texto legible y estructurado de la boleta
function generateReceiptText(receipt, order, { width = '58mm', storeInfo = {} } = {}) {
  const cols = width === '80mm' ? 48 : 32;
  const lines = [];

  const name = storeInfo.name || 'POLOLAB PERÚ S.A.C.';
  const ruc = storeInfo.ruc ? `R.U.C. ${storeInfo.ruc}` : 'R.U.C. 20608974512';
  const address = storeInfo.address || 'Av. Larco 743, Miraflores, Lima';
  const phone = storeInfo.phone ? `Tel: ${storeInfo.phone}` : 'Tel: (01) 445-8920';

  lines.push(line(cols, '='));
  lines.push(center(name, cols));
  lines.push(center(ruc, cols));
  if (address) lines.push(center(address, cols));
  if (phone) lines.push(center(phone, cols));
  lines.push(line(cols, '='));

  lines.push(center('BOLETA DE VENTA ELECTRÓNICA', cols));
  lines.push(center(`Nº ${receipt.receipt_number}`, cols));
  lines.push(line(cols, '-'));

  const dateStr = receipt.issue_date ? receipt.issue_date.slice(0, 19).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' ');
  lines.push(`FECHA: ${dateStr}`);
  lines.push(`CLIENTE: ${receipt.customer_name || 'Cliente Varios'}`);
  if (receipt.customer_phone) lines.push(`TELÉFONO: ${receipt.customer_phone}`);
  if (receipt.customer_address) lines.push(`DIRECCIÓN: ${receipt.customer_address}`);
  if (receipt.customer_city) lines.push(`CIUDAD: ${receipt.customer_city}`);
  lines.push(`MÉTODO PAGO: ${receipt.payment_method_label || receipt.payment_method}`);
  lines.push(`ESTADO PAGO: ${receipt.payment_status || 'VERIFICADO / PAGADO'}`);
  lines.push(line(cols, '-'));

  const items = order?.items || receipt?.items || [];

  // Encabezado de items
  if (cols === 48) {
    lines.push('CANT  DESCRIPCIÓN                    P.U.      TOTAL');
    lines.push(line(cols, '-'));
    for (const it of items) {
      const qty = `${it.quantity}x`;
      const unit = formatMoney(it.unit_price);
      const sub = formatMoney(it.unit_price * it.quantity);
      let desc = it.product_name;
      if (it.size) desc += ` (${it.size})`;
      lines.push(`${padRight(qty, 6)}${padRight(desc, 22)} ${padLeft(unit, 9)} ${padLeft(sub, 9)}`);
      if (it.custom_text) {
        lines.push(`      * Estampado: "${it.custom_text}"`);
      }
    }
  } else {
    lines.push('CANT  DESCRIPCIÓN              TOTAL');
    lines.push(line(cols, '-'));
    for (const it of items) {
      const qty = `${it.quantity}x`;
      const unit = formatMoney(it.unit_price);
      const sub = formatMoney(it.unit_price * it.quantity);
      const desc = it.product_name.slice(0, 18);
      lines.push(`${padRight(qty, 4)}${padRight(desc, 18)} ${padLeft(sub, 9)}`);
      lines.push(`    Talla: ${it.size} | P.U. ${unit}`);
      if (it.custom_text) {
        lines.push(`    * Estampado: "${it.custom_text}"`);
      }
    }
  }

  lines.push(line(cols, '-'));

  // Totales
  const printTotalLine = (label, value) => {
    const lbl = padRight(label, cols - 14);
    const val = padLeft(value, 14);
    lines.push(`${lbl}${val}`);
  };

  printTotalLine('SUBTOTAL:', formatMoney(receipt.subtotal));
  if (receipt.shipping > 0) {
    printTotalLine('ENVÍO:', formatMoney(receipt.shipping));
  } else {
    printTotalLine('ENVÍO:', 'GRATIS');
  }
  if (receipt.discount > 0) {
    printTotalLine('DESCUENTO:', `-${formatMoney(receipt.discount)}`);
  }
  lines.push(line(cols, '='));
  printTotalLine('TOTAL:', formatMoney(receipt.total));
  lines.push(line(cols, '='));

  lines.push('');
  lines.push(center('¡GRACIAS POR TU COMPRA!', cols));
  lines.push(center('POLOLAB · Diseñado en la calle', cols));
  lines.push(center('Hecho en Perú', cols));
  lines.push(line(cols, '='));
  lines.push('');

  return lines.join('\n');
}

// Construye el buffer binario con comandos ESC/POS para la impresora térmica
function buildEscPosBuffer(receipt, order, { width = '58mm', autoCut = true, storeInfo = {} } = {}) {
  const text = generateReceiptText(receipt, order, { width, storeInfo });
  const parts = [];

  // Reset e inicialización de la impresora
  parts.push(COMMANDS.INIT);

  // Seleccionar tabla de caracteres Latin-1 / CP858 (si la impresora lo soporta)
  parts.push(Buffer.from([0x1b, 0x74, 0x13])); // ESC t 19 (CP858)

  // Enviar el texto como buffer compatible (ISO-8859-1 para caracteres especiales españoles: ñ, á, é, etc.)
  const encoded = Buffer.from(text, 'latin1');
  parts.push(encoded);

  // Alimentar papel
  parts.push(COMMANDS.FEED_LINES(4));

  // Corte automático si está habilitado
  if (autoCut) {
    parts.push(COMMANDS.CUT_FULL);
  }

  return Buffer.concat(parts);
}

// Envía el buffer binario o texto a la impresora física en Windows
async function sendToWindowsPrinter(printerName, buffer, docName = 'Boleta') {
  if (process.platform !== 'win32') {
    // Entorno no Windows (simulación exitosa)
    return { ok: true, message: 'Impresión simulada en entorno de desarrollo.' };
  }

  const tempDir = os.tmpdir();
  const scriptPath = path.join(tempDir, `print_script_${Date.now()}.ps1`);
  const dataPath = path.join(tempDir, `print_job_${Date.now()}.bin`);

  try {
    fs.writeFileSync(scriptPath, RAW_PRINTER_PS_SCRIPT, 'utf8');
    fs.writeFileSync(dataPath, buffer);

    return await new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-PrinterName',
          printerName,
          '-FilePath',
          dataPath,
          '-DocName',
          docName,
        ],
        { timeout: 15000 },
        (err, stdout, stderr) => {
          if (err) {
            const msg = (stderr || stdout || err.message).trim();
            return reject(new Error(`Error al enviar a impresora '${printerName}': ${msg}`));
          }
          resolve({ ok: true, message: 'Enviado correctamente a la cola de impresión.' });
        },
      );
    });
  } finally {
    try {
      if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
      if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
    } catch {}
  }
}

// Imprime un ticket de prueba para calibrar y verificar la impresora física
async function printTestTicket(printerName, { width = '58mm', autoCut = true, storeInfo = {} } = {}) {
  const cols = width === '80mm' ? 48 : 32;
  const sampleReceipt = {
    receipt_number: 'PRUEBA-0001',
    issue_date: new Date().toISOString(),
    customer_name: 'Impresión de Prueba',
    customer_phone: '999 888 777',
    customer_address: 'Configuración de Impresora',
    customer_city: 'Lima',
    payment_method: 'Prueba Local',
    payment_method_label: 'Verificación de Sistema',
    payment_status: 'PRUEBA EXITOSA',
    subtotal: 7990,
    shipping: 0,
    discount: 0,
    total: 7990,
  };

  const sampleOrder = {
    items: [
      {
        product_name: 'Ticket de Calibración',
        size: width,
        quantity: 1,
        unit_price: 7990,
        custom_text: 'TEST OK',
      },
    ],
  };

  const buffer = buildEscPosBuffer(sampleReceipt, sampleOrder, { width, autoCut, storeInfo });

  if (!printerName) {
    throw new Error('No se ha seleccionado ninguna impresora en la configuración.');
  }

  return await sendToWindowsPrinter(printerName, buffer, 'Ticket de Prueba');
}

// Envía el comprobante a la Central de Impresión en la nube (Cloud Print)
async function sendToCentralPrinter({
  jobsUrl,
  siteAccessToken,
  submitToken,
  source = 'POLOLAB',
  externalId,
  title,
  content,
  copies = 1,
}) {
  if (!jobsUrl || !siteAccessToken || !submitToken) {
    throw new Error('Faltan configurar la URL o los tokens de la Central de Impresión');
  }

  const res = await fetch(jobsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'OAI-Sites-Authorization': `Bearer ${siteAccessToken}`,
      'Authorization': `Bearer ${submitToken}`,
    },
    body: JSON.stringify({
      source,
      external_id: String(externalId),
      title: title || `Boleta ${externalId}`,
      content,
      copies: Math.min(Math.max(Number(copies) || 1, 1), 3),
    }),
  });

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = { message: rawText };
  }

  if (!res.ok) {
    throw new Error(`Error en Central de Impresión (${res.status}): ${data.error || data.message || rawText}`);
  }

  return {
    ok: true,
    jobId: data.job?.id,
    status: data.job?.status || 'queued',
    duplicate: Boolean(data.duplicate),
    createdAt: data.job?.created_at,
  };
}

module.exports = {
  listPrinters,
  generateReceiptText,
  buildEscPosBuffer,
  sendToWindowsPrinter,
  sendToCentralPrinter,
  printTestTicket,
  formatMoney,
};
