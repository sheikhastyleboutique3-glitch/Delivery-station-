import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { deleteDocument, getDocumentFile } from '@/lib/hr/documents';

type P = { id: string };

/** يعرض الملف أو ينزّله. بيانات شخصية: لا تخزين مؤقت، ولا تنفيذ لأي محتوى */
export const GET = route<P>({ roles: ['ADMIN'] }, async ({ actor, params, query }) => {
  const doc = await getDocumentFile(prisma, actor, params.id);
  const disposition = query.download === '1' ? 'attachment' : 'inline';
  const ascii = doc.fileName.replace(/[^\x20-\x7e]/g, '_');
  return new Response(new Uint8Array(doc.file!.data), {
    headers: {
      'Content-Type': doc.mimeType,
      'Content-Length': String(doc.sizeBytes),
      'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});

export const DELETE = route<P>({ roles: ['ADMIN'] }, async ({ actor, params }) => deleteDocument(prisma, actor, params.id));
