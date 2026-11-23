import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { Errors } from '@/lib/errors';
import { REPORT_KINDS, buildReport, toCsv, toXlsx, type ReportKind } from '@/lib/services/reports';

type P = { kind: string };
export const GET = route<P>({ roles: ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER'] }, async ({ actor, params, query }) => {
  if (!REPORT_KINDS.includes(params.kind as ReportKind)) throw Errors.notFound('التقرير');
  const report = await buildReport(prisma, actor, params.kind as ReportKind, query);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `rasd-${params.kind}-${stamp}`;
  if (query.format === 'csv') {
    return new Response(toCsv(report), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  if (query.format === 'xlsx') {
    const buf = await toXlsx(report);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  return report;
});
