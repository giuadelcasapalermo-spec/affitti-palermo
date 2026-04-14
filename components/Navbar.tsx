'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, CalendarDays, BookOpen, BookMarked, Settings, LogOut } from 'lucide-react';
import Image from 'next/image';

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
    <>
      {/* Desktop navbar */}
      <nav className="hidden md:block bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="Logo" width={32} height={32} className="object-contain" />
            <span className="font-bold text-lg tracking-tight text-gray-900">GiuAdel casa Palermo</span>
          </div>
          <div className="flex items-center gap-1">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  pathname === href ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Icon size={15} />
                {label}
              </Link>
            ))}
            <button
              onClick={logout}
              title="Esci"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors ml-2 border-l border-gray-200 pl-4"
            >
              <LogOut size={15} />
              Esci
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile top bar */}
      <nav className="md:hidden bg-white border-b border-gray-200 shadow-sm">
        <div className="px-4 flex items-center justify-between h-12">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="Logo" width={26} height={26} className="object-contain" />
            <span className="font-bold text-base tracking-tight text-gray-900">GiuAdel casa Palermo</span>
          </div>
          <button onClick={logout} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 shadow-lg">
        <div className="grid grid-cols-5 h-16">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${
                pathname === href ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={22} strokeWidth={pathname === href ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
