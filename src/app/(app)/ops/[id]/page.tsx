import { OperationReceipt } from './receipt';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperationReceipt id={id} />;
}
