import { notFound } from 'next/navigation';
import Nav from '@/components/Nav';
import TaskView from '@/components/TaskView';
import { requirePage } from '@/lib/guard';
import { getTask, getTurns } from '@/lib/tasks';
import { eventsSince } from '@/lib/bus';
import { branchUrl, compareUrl } from '@/lib/github';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage();
  const { id } = await params;

  const task = getTask(id);
  if (!task) notFound();

  return (
    <>
      <Nav />
      <main className="shell">
        <TaskView
          initialTask={task}
          initialTurns={getTurns(id)}
          initialEvents={eventsSince(id, 0)}
          links={{
            branch: branchUrl(task.repo_owner, task.repo_name, task.branch),
            compare: compareUrl(task.repo_owner, task.repo_name, task.base_branch, task.branch),
          }}
        />
      </main>
    </>
  );
}
