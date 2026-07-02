import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'

// Local dev middleware so the POST /api/* endpoints work under `npm run dev`
// exactly like the Vercel serverless functions do in production. Each route
// loads the same shared run module through Vite's SSR pipeline.
function apiDevPlugin(opts: {
  name: string
  route: string
  modulePath: string // the api/_lib module exporting the run function
  exportName: string
  failMessage: string
}): Plugin {
  return {
    name: opts.name,
    configureServer(server) {
      server.middlewares.use(
        opts.route,
        async (req: IncomingMessage, res: ServerResponse) => {
          const json = (status: number, body: unknown) => {
            res.statusCode = status
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(body))
          }
          if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })
          try {
            const { getUserId } = await server.ssrLoadModule('/api/_lib/auth.ts')
            const mod = await server.ssrLoadModule(opts.modulePath)
            const run = mod[opts.exportName] as (
              body: unknown
            ) => Promise<{ status: number; payload: unknown }>
            const userId = await getUserId(req.headers.authorization)
            if (!userId) return json(401, { error: 'Not authenticated.' })
            const chunks: Buffer[] = []
            for await (const c of req) chunks.push(c as Buffer)
            const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
            const { status, payload } = await run(body)
            return json(status, payload)
          } catch {
            return json(500, { error: opts.failMessage })
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
    plugins: [
      react(),
      apiDevPlugin({
        name: 'api-extract-dev',
        route: '/api/extract',
        modulePath: '/api/_lib/run.ts',
        exportName: 'runExtraction',
        failMessage: 'Extraction failed.',
      }),
      apiDevPlugin({
        name: 'api-detect-style-dev',
        route: '/api/detect-style',
        modulePath: '/api/_lib/style-run.ts',
        exportName: 'runStyleDetect',
        failMessage: 'Style detection failed.',
      }),
    ],
  }
})
