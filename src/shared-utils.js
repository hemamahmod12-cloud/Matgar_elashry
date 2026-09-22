/* أدوات مشتركة مستقلة عن واجهة النظام — متوافقة مع GitHub Pages دون bundler. */
(function (global) {
  'use strict';

  const CSV_HEADER_MAP = {
    name: 'name', 'اسم المنتج': 'name', 'الاسم': 'name',
    barcode: 'barcode', 'باركود': 'barcode', 'الباركود': 'barcode', 'كود': 'barcode',
    category: 'category', 'فئة': 'category', 'الفئة': 'category',
    buyprice: 'buyPrice', 'buy price': 'buyPrice', 'سعر الشراء': 'buyPrice',
    sellprice: 'sellPrice', 'sell price': 'sellPrice', 'سعر البيع': 'sellPrice',
    qty: 'qty', quantity: 'qty', 'الكمية': 'qty',
    minqty: 'minQty', 'min qty': 'minQty', 'الحد الادنى': 'minQty', 'حد التنبيه': 'minQty',
    unit: 'unit', 'الوحدة': 'unit'
  };

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function formatMoney(value, currency) {
    return roundMoney(value).toFixed(2) + ' ' + (currency || 'ج.م');
  }

  function daysToExpiry(dateStr, now = new Date()) {
    if (!dateStr) return null;
    const expiry = new Date(dateStr).setHours(0, 0, 0, 0);
    const today = new Date(now).setHours(0, 0, 0, 0);
    return Math.round((expiry - today) / 86400000);
  }

  function todayArabic(now = new Date()) {
    return new Date(now).toLocaleDateString('ar-EG', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function formatDateShort(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('ar-EG', { month: '2-digit', day: '2-digit' }) + ' ' +
      date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  }

  function safeImageDataUrl(value) {
    const source = String(value || '');
    if (source.length > 2 * 1024 * 1024) return '';
    return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(source) ? source : '';
  }

  function csvCells(line, delimiter) {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"') { cell += '"'; i += 1; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (char === delimiter && !quoted) { cells.push(cell.trim()); cell = ''; continue; }
      cell += char;
    }
    cells.push(cell.trim());
    return cells;
  }

  function mapCsvHeader(header) {
    const raw = String(header || '').trim();
    return CSV_HEADER_MAP[raw.toLowerCase()] || CSV_HEADER_MAP[raw] || null;
  }

  function parseCSV(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
    let lines = clean.split('\n').filter(line => line.trim().length);
    if (lines[0] && /^sep\s*=\s*[,;\t]$/i.test(lines[0].trim())) lines = lines.slice(1);
    if (lines.length < 2) return [];
    const delimiters = [',', ';', '\t'];
    const delimiter = delimiters.sort((a, b) => csvCells(lines[0], b).length - csvCells(lines[0], a).length)[0];
    const headers = csvCells(lines[0], delimiter).map(mapCsvHeader);
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
      const cells = csvCells(lines[i], delimiter);
      const row = {};
      headers.forEach((key, index) => { if (key) row[key] = (cells[index] || '').trim(); });
      if (row.name) rows.push(row);
    }
    return rows;
  }

  function importNumber(value, fallback = 0) {
    let normalized = String(value ?? '').trim()
      .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[٫٬]/g, '.');
    if (normalized.includes(',') && !normalized.includes('.')) normalized = normalized.replace(',', '.');
    normalized = normalized.replace(/\s/g, '').replace(/,/g, '');
    const number = parseFloat(normalized);
    return Number.isFinite(number) ? number : fallback;
  }

  global.MatgarUtils = Object.freeze({
    escapeHtml, roundMoney, formatMoney, daysToExpiry, todayArabic, formatDateShort, safeImageDataUrl,
    csvCells, mapCsvHeader, parseCSV, importNumber
  });
}(window));
