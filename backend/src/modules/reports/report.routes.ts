import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticateUser } from '../../middleware/auth';
import { requireCompany } from '../../middleware/company';
import { validateRequest } from '../../middleware/validate';
import { ok } from '../../utils/response';
import { audit } from '../audit/audit';
import { reportToPdf, reportToXlsx } from './report.export';
import { REPORT_KEYS, REPORTS, runReport, type ReportKey } from './report.service';

export const reportsRouter = Router();
reportsRouter.use(authenticateUser, requireCompany({ permission: 'company:bookings:read' }));

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const params = validateRequest({
  params: z.object({ key: z.enum(REPORT_KEYS as [ReportKey, ...ReportKey[]]) }),
  query: z.object({ from: date.optional(), to: date.optional(), format: z.enum(['xlsx', 'pdf']).optional() }),
});

reportsRouter.get('/', (_req: Request, res: Response) => {
  ok(res, 'Reports', { reports: REPORT_KEYS.map((key) => ({ key, ...REPORTS[key] })) });
});

reportsRouter.get('/:key', params, async (req: Request, res: Response) => {
  const { key } = res.locals.params as { key: ReportKey };
  ok(res, 'Report', { report: await runReport(req.company!.id, key, res.locals.query) });
});

/** Excel or PDF export of the same live report. */
reportsRouter.get('/:key/export', params, async (req: Request, res: Response) => {
  const { key } = res.locals.params as { key: ReportKey };
  const q = res.locals.query as { from?: string; to?: string; format?: 'xlsx' | 'pdf' };
  const format = q.format ?? 'xlsx';
  const report = await runReport(req.company!.id, key, q);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: req.company!.id }, select: { name: true, companyCode: true } });
  const label = `${company.name} (${company.companyCode})`;
  const buffer = format === 'pdf' ? await reportToPdf(report, label) : await reportToXlsx(report, label);
  await audit({ action: 'report.exported', entityType: 'report', metadata: { key, format, from: report.range.from, to: report.range.to, rows: report.rows.length }, req });
  const fileName = `${key}_${report.range.from}_${report.range.to}.${format}`;
  res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
});
