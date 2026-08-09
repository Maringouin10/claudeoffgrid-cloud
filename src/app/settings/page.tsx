import { headers } from 'next/headers';
import Nav from '@/components/Nav';
import SettingsForm from '@/components/SettingsForm';
import { requirePage } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requirePage();

  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3006';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const baseUrl = process.env.PUBLIC_URL?.replace(/\/+$/, '') || `${proto}://${host}`;

  return (
    <>
      <Nav />
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>Réglages</h1>
            <p className="sub">Identifiants, comportement de l&apos;agent et webhooks n8n.</p>
          </div>
        </div>
        <SettingsForm baseUrl={baseUrl} />
      </main>
    </>
  );
}
