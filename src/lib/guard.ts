import { redirect } from 'next/navigation';
import { isAuthenticated } from './auth';
import { isSetupComplete, setupState } from './settings';

/**
 * Server-component guard. Sends the visitor to the wizard while the instance
 * is unconfigured, and to the login page when they have no session.
 */
export async function requirePage(): Promise<void> {
  const authed = await isAuthenticated();
  const state = setupState();

  if (!state.hasPassword) redirect('/setup');
  if (!authed) redirect('/login');
  if (!isSetupComplete()) redirect('/setup');
}
