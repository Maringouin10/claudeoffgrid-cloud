import Nav from '@/components/Nav';
import ReposManager from '@/components/ReposManager';
import { requirePage } from '@/lib/guard';
import { getDb, type RepoRow } from '@/lib/db';
import { SETTING, getSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function ReposPage() {
  await requirePage();

  const repos = getDb().prepare('SELECT * FROM repos ORDER BY owner, name').all() as RepoRow[];
  const slug = getSetting(SETTING.githubAppSlug);

  return (
    <>
      <Nav />
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>Dépôts</h1>
            <p className="sub">
              Les dépôts où l&apos;agent peut lire, committer et pousser une branche.
            </p>
          </div>
          {slug && (
            <a
              className="btn ghost"
              style={{ padding: '9px 16px' }}
              href={`https://github.com/apps/${slug}/installations/new`}
              target="_blank"
              rel="noreferrer"
            >
              Gérer l&apos;accès sur GitHub ↗
            </a>
          )}
        </div>
        <ReposManager initialRepos={repos} />
      </main>
    </>
  );
}
