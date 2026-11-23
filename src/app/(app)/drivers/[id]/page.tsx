import { DriverProfile } from './driver-profile';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DriverProfile id={id} />;
}
