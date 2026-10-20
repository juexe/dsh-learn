// Extract the workspace package graph from <root>/packages/*/*/package.json.
// Scope: in-repo peerDependencies (the same edge set as the harness's own
// docs/module-graph.md), plus manifest facts needed to describe each package.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, repoRoot } from './paths.mjs'

const SCOPE = '@deepseek-ai/dsh-'
const root = repoRoot()
const out = dataDir()
mkdirSync(out, { recursive: true })

/** The `## Summary` paragraph of a package README, collapsed to one line. */
function readmeSummary(pkgDir) {
  const abs = join(pkgDir, 'README.md')
  if (!existsSync(abs)) return ''
  const lines = readFileSync(abs, 'utf8').split('\n')
  const start = lines.findIndex(line => /^##\s+Summary\s*$/.test(line.trim()))
  if (start === -1) return ''
  const collected = []
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line.trim()) || /^-----?\s*$/.test(line.trim())) break
    if (line.trim() === '') {
      if (collected.length > 0) break
      continue
    }
    collected.push(line.trim())
  }
  return collected.join(' ')
}

const packages = []
for (const group of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
  if (!group.isDirectory()) continue
  const groupDir = join(root, 'packages', group.name)
  for (const leaf of readdirSync(groupDir, { withFileTypes: true })) {
    if (!leaf.isDirectory()) continue
    const pkgDir = join(groupDir, leaf.name)
    const manifest = join(pkgDir, 'package.json')
    if (!existsSync(manifest)) continue
    const json = JSON.parse(readFileSync(manifest, 'utf8'))
    if (typeof json.name !== 'string') continue
    const short = json.name.startsWith(SCOPE) ? json.name.slice(SCOPE.length) : json.name
    const peers = Object.keys(json.peerDependencies ?? {}).sort()
    packages.push({
      group: group.name,
      leaf: leaf.name,
      name: json.name,
      short,
      rel: `packages/${group.name}/${leaf.name}`,
      version: json.version ?? '',
      private: json.private === true,
      description: json.description ?? '',
      peerCount: peers.filter(dep => dep.startsWith(SCOPE)).length,
      peers: peers.filter(dep => dep.startsWith(SCOPE)).map(dep => dep.slice(SCOPE.length)),
      externalPeers: peers.filter(dep => !dep.startsWith(SCOPE)),
      optionalPeers: Object.entries(json.peerDependenciesMeta ?? {})
        .filter(([, meta]) => meta?.optional === true)
        .map(([dep]) => dep)
        .sort(),
      runtimeDeps: Object.keys(json.dependencies ?? {}).filter(dep => dep.startsWith(SCOPE)).sort(),
      readme: readmeSummary(pkgDir),
    })
  }
}

packages.sort((a, b) => a.rel.localeCompare(b.rel))

const names = new Set(packages.map(pkg => pkg.short))
const problems = []
for (const pkg of packages) {
  for (const dep of pkg.peers) if (!names.has(dep)) problems.push(`${pkg.short} -> missing peer ${dep}`)
  for (const dep of pkg.runtimeDeps.map(dep => dep.slice(SCOPE.length))) {
    if (!names.has(dep)) problems.push(`${pkg.short} -> missing runtime dependency ${dep} (likely lives outside packages/)`)
  }
}

const edgeCount = packages.reduce((sum, pkg) => sum + pkg.peers.length, 0)
writeFileSync(join(out, 'packages.json'), `${JSON.stringify({ root, packages, problems }, null, 2)}\n`)
console.log(`root=${root}`)
console.log(`packages=${packages.length} peerEdges=${edgeCount} problems=${problems.length}`)
for (const problem of problems) console.log(`  ! ${problem}`)
