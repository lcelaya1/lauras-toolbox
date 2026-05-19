import Link from "next/link";

const tools = [
  {
    href: "/recordings",
    emoji: "📼",
    title: "Mis grabaciones",
    description: "Biblioteca de grabaciones guardadas con su transcripción. Accede, reproduce y copia desde un solo lugar.",
    tag: "Biblioteca",
  },
  {
    href: "/meetings",
    emoji: "📅",
    title: "Mis reuniones",
    description: "Notas de reuniones sincronizadas desde Granola AI. Guardadas para siempre, aunque caduquen en la app.",
    tag: "Granola · Sync",
  },
];

export default function Home() {
  return (
    <div className="px-8 py-10 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Herramientas</h1>
        <p className="mt-1 text-sm text-gray-500">Todas las utilidades en un solo lugar.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5
              hover:border-indigo-200 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">{tool.emoji}</span>
              <span className="text-[11px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                {tool.tag}
              </span>
            </div>
            <div>
              <p className="font-medium text-gray-900 text-sm group-hover:text-indigo-700 transition-colors">
                {tool.title}
              </p>
              <p className="mt-1 text-xs text-gray-500 leading-relaxed">{tool.description}</p>
            </div>
          </Link>
        ))}

      </div>
    </div>
  );
}
