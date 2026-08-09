'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Tâches' },
  { href: '/repos', label: 'Dépôts' },
  { href: '/settings', label: 'Réglages' },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <span className="brand-dot" />
          Claude Offgrid Cloud
        </Link>
        <nav className="nav">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                link.href === '/' ? (pathname === '/' ? 'active' : '') : pathname.startsWith(link.href) ? 'active' : ''
              }
            >
              {link.label}
            </Link>
          ))}
          <button onClick={logout}>Déconnexion</button>
        </nav>
      </div>
    </header>
  );
}
