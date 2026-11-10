import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Format, ReportResult } from './report.service';

const TZ = 'Asia/Kolkata';

function fmt(v: unknown, f: Format): string {
  if (v === null || v === undefined || v === '') return '-';
  switch (f) {
    case 'currency':
      return `INR ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    case 'percent':
      return `${Number(v).toFixed(1)}%`;
    case 'km':
      return `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`;
    case 'number':
      return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    case 'date':
      return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(v as string));
    case 'datetime':
      return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(v as string));
    default:
      return String(v);
  }
}

/** Excel workbook: report header, summary block, and a typed data table (numbers stay numeric). */
export async function reportToXlsx(r: ReportResult, companyName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TankerLink';
  wb.created = new Date();
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([`${companyName} · ${r.range.from} to ${r.range.to} · generated ${fmt(new Date().toISOString(), 'datetime')} IST`]).font = { color: { argb: 'FF5B6676' } };
  ws.addRow([r.description]).font = { italic: true, color: { argb: 'FF5B6676' } };
  ws.addRow([]);
  for (const s of r.summary) {
    const row = ws.addRow([s.label, typeof s.value === 'number' && s.format !== 'text' ? s.value : fmt(s.value, s.format)]);
    row.getCell(1).font = { bold: true };
    if (s.format === 'currency') row.getCell(2).numFmt = '"₹"#,##,##0.00';
    if (s.format === 'percent') row.getCell(2).numFmt = '0.0"%"';
  }
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  });
  for (const row of r.rows) {
    const values = r.columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined) return null;
      if (c.format === 'date' || c.format === 'datetime') return new Date(v as string);
      if (['currency', 'number', 'percent', 'km'].includes(c.format)) return Number(v);
      return String(v);
    });
    const added = ws.addRow(values);
    r.columns.forEach((c, i) => {
      const cell = added.getCell(i + 1);
      if (c.format === 'currency') cell.numFmt = '"₹"#,##,##0.00';
      if (c.format === 'percent') cell.numFmt = '0.0"%"';
      if (c.format === 'date') cell.numFmt = 'dd-mmm-yyyy';
      if (c.format === 'datetime') cell.numFmt = 'dd-mmm-yyyy hh:mm';
    });
  }
  ws.columns.forEach((col, i) => {
    const c = r.columns[i];
    col.width = c ? Math.min(42, Math.max(12, c.label.length + 4, c.format === 'text' ? 22 : 14)) : 18;
  });
  if (r.rows.some((x) => x.demo)) ws.addRow([]).getCell(1).value = 'Contains demo data (marked DEMO in the portal).';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Landscape PDF with summary and a paginated table. */
export function reportToPdf(r: ReportResult, companyName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: r.title, Author: 'TankerLink' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 72;

    doc.rect(0, 0, doc.page.width, 64).fill('#0b1b3f');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(16).text('TankerLink', 36, 18);
    doc.font('Helvetica-Bold').fontSize(13).text(r.title, 300, 18, { width: W - 264, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fillColor('#bfdbfe').text(`${companyName} · ${r.range.from} to ${r.range.to}`, 300, 38, { width: W - 264, align: 'right' });
    doc.y = 80;
    doc.fillColor('#5b6676').fontSize(9).text(r.description, 36, doc.y);
    doc.moveDown(0.8);

    // Summary cards
    const cardW = (W - 3 * 10) / 4;
    const y0 = doc.y;
    r.summary.slice(0, 4).forEach((s, i) => {
      const x = 36 + i * (cardW + 10);
      doc.roundedRect(x, y0, cardW, 44, 6).fillAndStroke('#f4f6fa', '#e2e7ef');
      doc.fillColor('#5b6676').font('Helvetica').fontSize(8).text(s.label, x + 8, y0 + 7, { width: cardW - 16 });
      doc.fillColor('#0b1b3f').font('Helvetica-Bold').fontSize(12).text(fmt(s.value, s.format), x + 8, y0 + 21, { width: cardW - 16 });
    });
    doc.y = y0 + 58;

    // Table
    const cols = r.columns;
    const weights = cols.map((c) => (c.format === 'text' ? 2 : 1.2));
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * W);
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(36, y - 3, W, 18).fill('#1d4ed8');
      let x = 36;
      cols.forEach((c, i) => {
        doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8).text(c.label, x + 4, y, { width: widths[i] - 8, lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.y = y + 18;
    };
    drawHeader();
    r.rows.forEach((row, idx) => {
      if (doc.y > doc.page.height - 50) {
        doc.addPage();
        doc.y = 36;
        drawHeader();
      }
      const y = doc.y;
      if (idx % 2) doc.rect(36, y - 3, W, 16).fill('#f8fafc');
      let x = 36;
      cols.forEach((c, i) => {
        const align = ['currency', 'number', 'percent', 'km'].includes(c.format) ? 'right' : 'left';
        doc.fillColor('#0b1b3f').font('Helvetica').fontSize(7.5).text(fmt(row[c.key], c.format), x + 4, y, { width: widths[i] - 8, align, lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.y = y + 16;
    });
    if (r.rows.length === 0) doc.fillColor('#5b6676').fontSize(9).text('No records in this period.', 36, doc.y + 6);
    doc.moveDown(1.5);
    doc.fillColor('#5b6676').fontSize(7.5).text(
      `${r.rows.length} row(s). Generated ${fmt(new Date().toISOString(), 'datetime')} IST from live records.${r.rows.some((x) => x.demo) ? ' Includes demo data.' : ''}`,
      36,
      doc.y,
    );
    doc.end();
  });
}
