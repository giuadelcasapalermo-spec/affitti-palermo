'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, CalendarDays, BookOpen, BookMarked, Settings, LogOut } from 'lucide-react';

const links = [
  { href: '/calendario', label: 'Calendario', icon: CalendarDays },
  { href: '/prenotazioni', label: 'Prenotazioni', icon: BookOpen },
  { href: '/uscite', label: 'Prima Nota', icon: BookMarked },
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/impostazioni', label: 'Impostazioni', icon: Settings },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <nav className="bg-blue-700 text-white shadow-md">
      <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14">
        <span className="font-bold text-lg tracking-tight">GiuAdel casa Palermo</span>
        <div className="flex items-center gap-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                pathname === href
                  ? 'bg-white/20'
                  : 'hover:bg-white/10'
              }`}
            >
              <Icon size={15} />
              {label}
            </Link>
          ))}
          <button
            onClick={logout}
            title="Esci"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium hover:bg-white/10 transition-colors ml-2 border-l border-white/20 pl-4"
          >
            <LogOut size={15} />
            Esci
          </button>
        </div>
      </div>
    </nav>
  );
}
