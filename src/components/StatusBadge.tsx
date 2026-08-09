const LABELS: Record<string, string> = {
  queued: 'En file',
  running: 'En cours',
  pushing: 'Push',
  success: 'Réussi',
  failed: 'Échec',
  cancelled: 'Annulé',
};

export default function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{LABELS[status] ?? status}</span>;
}
