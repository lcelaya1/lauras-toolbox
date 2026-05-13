"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tools = [
  {
    href: "/audio",
    label: "Transcriptor",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
        <path d="M5.5 9.643a.75.75 0 00-1.5 0V10a6 6 0 0012 0v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
      </svg>
    ),
  },
  {
    href: "/recordings",
    label: "Mis grabaciones",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M3.5 2A1.5 1.5 0 002 3.5v13A1.5 1.5 0 003.5 18h13a1.5 1.5 0 001.5-1.5V8.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0012.378 3H3.5zm4.75 8.75a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5zm0-3a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const path = usePathname();

  return (
    <aside className="flex flex-col w-56 shrink-0 h-screen sticky top-0 bg-white border-r border-gray-100">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600 text-white text-sm font-bold select-none">
            LT
          </span>
          <span className="font-semibold text-gray-900 text-sm">Laura&apos;s Toolbox</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Herramientas
        </p>
        {tools.map((t) => {
          const active = path === t.href || path.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors
                ${active
                  ? "bg-indigo-50 text-indigo-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
            >
              <span className={active ? "text-indigo-600" : "text-gray-400"}>{t.icon}</span>
              {t.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold select-none">
            LC
          </span>
          <span className="text-sm text-gray-600 truncate">Laura Celaya</span>
        </div>
      </div>
    </aside>
  );
}
