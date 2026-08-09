import { NextResponse } from 'next/server';
import { getDb, type RepoRow } from '@/lib/db';
import { randomId } from '@/lib/crypto';
import { requireSession } from '@/lib/auth';
import { getRepo, listAllAccessibleRepos } from '@/lib/github';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const url = new URL(req.url);
  // ?available=1 lists what the GitHub App can reach but is not yet connected.
  if (url.searchParams.get('available') === '1') {
    try {
      const remote = await listAllAccessibleRepos();
      const connected = new Set(
        (getDb().prepare('SELECT owner, name FROM repos').all() as RepoRow[]).map(
          (r) => `${r.owner}/${r.name}`,
        ),
      );
      return NextResponse.json({
        repos: remote.map((r) => ({ ...r, connected: connected.has(r.fullName) })),
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  }

  const repos = getDb().prepare('SELECT * FROM repos ORDER BY owner, name').all() as RepoRow[];
  return NextResponse.json({ repos });
}

export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    owner?: string;
    name?: string;
    installationId?: number;
    defaultBranch?: string;
  };
  if (!body.owner || !body.name || !body.installationId) {
    return NextResponse.json(
      { error: 'owner, name et installationId sont requis' },
      { status: 400 },
    );
  }

  let defaultBranch = body.defaultBranch;
  if (!defaultBranch) {
    try {
      defaultBranch = (await getRepo(body.installationId, body.owner, body.name)).defaultBranch;
    } catch (err) {
      return NextResponse.json(
        { error: `Dépôt inaccessible : ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }
  }

  const id = `repo_${randomId(6)}`;
  getDb()
    .prepare(
      `INSERT INTO repos (id, owner, name, default_branch, installation_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner, name) DO UPDATE SET
         default_branch = excluded.default_branch,
         installation_id = excluded.installation_id`,
    )
    .run(id, body.owner, body.name, defaultBranch, body.installationId);

  const repo = getDb()
    .prepare('SELECT * FROM repos WHERE owner = ? AND name = ?')
    .get(body.owner, body.name) as RepoRow;
  return NextResponse.json({ repo }, { status: 201 });
}
