import { TripTable } from '@/components/transporter/TripTable';

export default function Page() {
  return <TripTable scope="history" title="Trip history" subtitle="Delivered, completed and cancelled trips" />;
}
