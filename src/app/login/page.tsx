import { redirect } from 'next/navigation';
import LoginForm from '@/components/LoginForm';
import { isAuthenticated } from '@/lib/auth';
import { setupState } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (!setupState().hasPassword) redirect('/setup');
  if (await isAuthenticated()) redirect('/');

  return (
    <div className="centered">
      <div className="narrow">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1>Claude Offgrid Cloud</h1>
          <p className="sub">Connecte-toi pour piloter l&apos;agent.</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
