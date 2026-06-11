import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'

// Local dev middleware so POST /api/extract works under `npm run dev` exactly
// like the Vercel serverless function does in production. It loads the same
// shared modules through Vite's SSR pipeline.
function apiExtractDevPlugin(): Plugin {
  return {
    name: 'api-extract-dev',
    configureServer(server) {
      server.middlewares.use(
        '/api/extract',
        async (req: IncomingMessage, res: ServerResponse) => {
          const json = (status: number, body: unknown) => {
            res.statusCode = status
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(body))
          }
          if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })
          try {
            const { getUserId } = await server.ssrLoadModule('/api/_lib/auth.ts')
            const { runExtraction } = await server.ssrLoadModule('/api/_lib/run.ts')
            const userId = await getUserId(req.headers.authorization)
            if (!userId) return json(401, { error: 'Not authenticated.' })
            const chunks: Buffer[] = []
            for await (const c of req) chunks.push(c as Buffer)
            const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
            const { status, payload } = await runExtraction(body)
            return json(status, payload)
          } catch {
            return json(500, { error: 'Extraction failed.' })
          }
        }
      )
    },
  }
}

// Local dev middleware for POST /api/detect-style, mirroring the Vercel
// serverless function (api/detect-style.ts). Dormant until ANTHROPIC_API_KEY is
// set, exactly like production.
function apiDetectStyleDevPlugin(): Plugin {
  return {
    name: 'api-detect-style-dev',
    configureServer(server) {
      server.middlewares.use(
        '/api/detect-style',
        async (req: IncomingMessage, res: ServerResponse) => {
          const json = (status: number, body: unknown) => {
            res.statusCode = status
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(body))
          }
          if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })
          try {
            const { getUserId } = await server.ssrLoadModule('/api/_lib/auth.ts')
            const { runStyleDetect } = await server.ssrLoadModule('/api/_lib/style-run.ts')
            const userId = await getUserId(req.headers.authorization)
            if (!userId) return json(401, { error: 'Not authenticated.' })
            const chunks: Buffer[] = []
            for await (const c of req) chunks.push(c as Buffer)
            const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
            const { status, payload } = await runStyleDetect(body)
            return json(status, payload)
          } catch {
            return json(500, { error: 'Style detection failed.' })
          }
        }
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Expose .env values to the server-side dev middleware (auth + Anthropic key).
  const env = loadEnv(mode, process.cwd(), '')
  for (const k of [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'ANTHROPIC_API_KEY',
  ]) {
    if (env[k] && !process.env[k]) process.env[k] = env[k]
  }

  return {
    // GitHub Pages served the app under a sub-path; Vercel serves at root.
    base: process.env.GITHUB_PAGES ? '/AmyMorrisTearSheets/' : '/',
    plugins: [react(), apiExtractDevPlugin(), apiDetectStyleDevPlugin()],
  }
})
