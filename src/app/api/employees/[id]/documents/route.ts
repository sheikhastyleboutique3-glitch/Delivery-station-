import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { AppError } from '@/lib/errors';
import { uploadDocument } from '@/lib/hr/documents';

type P = { id: string };

export const GET = route<P>({ roles: ['ADMIN'] }, async ({ params }) =>
  prisma.employeeDocument.findMany({
    where: { employeeId: params.id },
    orderBy: { createdAt: 'desc' },
    include: { uploadedBy: { select: { name: true } } },
  }),
);

export const POST = route<P>({ roles: ['ADMIN'] }, async ({ actor, params, req }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError('BAD_FORM', 400, 'تعذر قراءة الملف المرفوع');
  }
  return uploadDocument(prisma, actor, params.id, form);
});
