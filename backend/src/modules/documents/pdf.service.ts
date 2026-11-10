import PDFDocument from 'pdfkit';
import type { Prisma } from '@prisma/client';
import { formatInr } from '../../lib/money';

/**
 * Server-side PDF generation (booking summary/confirmation, freight invoice, payment receipt,
 * simulated delivery proof). Times are rendered in Asia/Kolkata. Demo records carry a DEMO watermark.
 */

const NAVY = '#0b1b3f';
const BLUE = '#1d4ed8';
const MUTED = '#5b6676';

export const ist = (d: Date | string | null | undefined, withTime = true) =>
  d
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
      }).format(new Date(d)) + (withTime ? ' IST' : '')
    : '-';

export const istDate = (d: Date | string | null | undefined) =>
  d ? new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d)) : '-';

type Doc = PDFKit.PDFDocument;

export interface PdfSection {
  title: string;
  rows: [string, string][];
}

export interface PdfSpec {
  title: string;
  reference: string;
  subtitle?: string;
  demo?: boolean;
  sections: PdfSection[];
  table?: { title: string; head: string[]; rows: string[][]; widths: number[]; totals?: [string, string][] };
  footer?: string;
}

function header(doc: Doc, spec: PdfSpec) {
  doc.rect(0, 0, doc.page.width, 92).fill(NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('TankerLink', 50, 28);
  doc.font('Helvetica').fontSize(9).fillColor('#bfdbfe').text('Oil Tanker Booking & Logistics Marketplace', 50, 54);
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#ffffff').text(spec.title, 300, 28, { width: doc.page.width - 350, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#bfdbfe').text(spec.reference, 300, 50, { width: doc.page.width - 350, align: 'right' });
  doc.fillColor(NAVY);
  doc.y = 112;
  if (spec.subtitle) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(spec.subtitle, 50, doc.y);
    doc.moveDown(0.8);
  }
}

function watermark(doc: Doc) {
  doc.save();
  doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.font('Helvetica-Bold').fontSize(70).fillColor('#ef4444').opacity(0.12);
  doc.text('DEMO DATA', 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center' });
  doc.restore();
  doc.opacity(1);
}

function section(doc: Doc, s: PdfSection) {
  if (doc.y > doc.page.height - 160) doc.addPage();
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(BLUE).text(s.title.toUpperCase(), 50, doc.y, { characterSpacing: 0.5 });
  doc.moveTo(50, doc.y + 3).lineTo(doc.page.width - 50, doc.y + 3).strokeColor('#dfe4eb').lineWidth(1).stroke();
  doc.moveDown(0.6);
  for (const [k, v] of s.rows) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, 50, y, { width: 160 });
    doc.font('Helvetica').fontSize(9.5).fillColor(NAVY).text(v || '-', 215, y, { width: doc.page.width - 265 });
    doc.y = Math.max(doc.y, y + 14) + 3;
  }
}

function table(doc: Doc, t: NonNullable<PdfSpec['table']>) {
  if (doc.y > doc.page.height - 200) doc.addPage();
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(BLUE).text(t.title.toUpperCase(), 50, doc.y);
  doc.moveDown(0.5);
  const startX = 50;
  const drawRow = (cells: string[], bold: boolean, fill?: string) => {
    const y = doc.y;
    if (fill) doc.rect(startX, y - 3, doc.page.width - 100, 18).fill(fill);
    let x = startX + 6;
    cells.forEach((c, i) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(NAVY).text(c, x, y, { width: t.widths[i] - 8, align: i === cells.length - 1 ? 'right' : 'left' });
      x += t.widths[i];
    });
    doc.y = y + 18;
  };
  drawRow(t.head, true, '#eef4ff');
  t.rows.forEach((r) => drawRow(r, false));
  if (t.totals) {
    doc.moveTo(startX, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#dfe4eb').stroke();
    doc.moveDown(0.3);
    for (const [k, v] of t.totals) {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text(k, 300, y, { width: 140 });
      doc.text(v, 440, y, { width: doc.page.width - 496, align: 'right' });
      doc.y = y + 16;
    }
  }
}

export function renderPdf(spec: PdfSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `${spec.title} ${spec.reference}`, Author: 'TankerLink' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if (spec.demo) doc.on('pageAdded', () => watermark(doc));
    if (spec.demo) watermark(doc);
    header(doc, spec);
    if (spec.demo) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#b91c1c').text('DEMO ENVIRONMENT — simulated record, not a real transaction.', 50, doc.y);
      doc.moveDown(0.5);
    }
    spec.sections.forEach((s) => section(doc, s));
    if (spec.table) table(doc, spec.table);
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(spec.footer ?? 'This is a computer-generated document and does not require a signature.', 50, doc.y, { width: doc.page.width - 100 });
    doc.text(`Generated ${ist(new Date())}`, 50, doc.y + 4);
    doc.end();
  });
}

export const money = (v: Prisma.Decimal.Value | null | undefined) => (v === null || v === undefined ? '-' : formatInr(v));
