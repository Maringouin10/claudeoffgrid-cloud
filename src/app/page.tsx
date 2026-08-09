import Nav from '@/components/Nav';
import Dashboard from '@/components/Dashboard';
import { requirePage } from '@/lib/guard';
import { getDb, type RepoRow } from '@/lib/db';
import { listTasks } from '@/lib/tasks';
import { defaultModel } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  await requirePage();

  const repos = getDb().prepare('SELECT * FROM repos ORDER BY owner, name').all() as RepoRow[];
  const tasks = listTasks(60);

  return (
    <>
      <Nav />
      <main className="shell">
        <Dashboard
          initialRepos={repos}
          initialTasks={tasks}
          defaultModel={defaultModel()}
        />
      </main>
    </>
  );
}
