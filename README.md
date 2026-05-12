# Laura's Toolbox

Colección de herramientas personales con sidebar de navegación. Construido con Next.js App Router y Tailwind CSS.

## Herramientas disponibles

| Herramienta | Ruta | Descripción |
|---|---|---|
| 🎙 Transcriptor | `/audio` | Transcribe audio en español usando Groq Whisper |

## Setup local

```bash
# 1. Instala dependencias
npm install

# 2. Configura las variables de entorno
cp .env.local.example .env.local
# → Edita .env.local y pega tu API key de Groq

# 3. Arranca el servidor
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Variables de entorno

| Variable | Descripción |
|---|---|
| `GROQ_API_KEY` | API key de Groq (gratuita en [console.groq.com](https://console.groq.com)) |

### Cómo obtener una API key de Groq (gratis)

1. Regístrate en [console.groq.com](https://console.groq.com)
2. Ve a **API Keys** → **Create API Key**
3. Copia la key y pégala en `.env.local`

## Deploy en Vercel

```bash
npx vercel
```

Añade `GROQ_API_KEY` en **Settings → Environment Variables** del proyecto en Vercel.

## Añadir una nueva herramienta

1. Crea `app/(tools)/mi-herramienta/page.tsx`
2. Añade una entrada en el array `tools` de `components/Sidebar.tsx`
3. Añade una tarjeta en `app/(tools)/page.tsx`

## Stack

- **Next.js 16** (App Router) + TypeScript
- **Tailwind CSS**
- **Groq API** — Whisper large v3 turbo
