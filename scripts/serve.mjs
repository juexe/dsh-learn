// Minimal static server for local browser verification of the generated page.
// Binds an ephemeral port so concurrent runs never collide.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, normalize } from 'node:path'
import { deliverableDir } from './paths.mjs'

const root = deliverableDir()
const types = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const server = createServer(async (req, res) => {
  const requested = decodeURIComponent((req.url ?? '/').split('?')[0])
  const file = normalize(requested === '/' ? `${root}/index.html` : `${root}/${requested.replace(/^\/+/, '')}`)
  if (!file.startsWith(root) || !isAbsolute(file)) {
    res.writeHead(403).end('forbidden')
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})

server.listen(0, '127.0.0.1', () => {
  console.log(`serving http://127.0.0.1:${server.address().port}/`)
})
