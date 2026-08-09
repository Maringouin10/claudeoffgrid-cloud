import { redirect } from 'next/navigation';
import SetupWizard from '@/components/SetupWizard';
import { isAuthenticated } from '@/lib/auth';
import { isSetupComplete, setupState } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const state = setupState();
  const authed = await isAuthenticated();

  if (state.hasPassword && !authed) redirect('/login');
  if (isSetupComplete() && params.force !== '1') redirect('/');

  const error = typeof params.error === 'string' ? params.error : null;

  return (
    <div className="centered">
      <div style={{ width: '100%', maxWidth: 620 }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <h1>Configuration</h1>
          <p className="sub">Trois étapes et l&apos;agent est opérationnel.</p>
        </div>
        <SetupWizard initialState={state} initialError={error} />
      </div>
    </div>
  );
}
