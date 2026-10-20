// Analyse the extracted package graph: group aggregation, layering,
// fan-in/fan-out, cycles, and optional-peer accounting.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths.mjs'

const dir = dataDir()
const { packages } = JSON.parse(readFileSync(join(dir, 'packages.json'), 'utf8'))
const byShort = new Map(packages.map(pkg => [pkg.short, pkg]))

const fanOut = new Map()
const fanIn = new Map(packages.map(pkg => [pkg.short, 0]))
const optionalEdges = []
const groupEdges = new Map()
const crossGroup = []
for (const pkg of packages) {
  fanOut.set(pkg.short, pkg.peers.length)
  for (const dep of pkg.peers) {
    fanIn.set(dep, (fanIn.get(dep) ?? 0) + 1)
    const target = byShort.get(dep)
    if (target === undefined) continue
    if (pkg.optionalPeers.includes(`@deepseek-ai/dsh-${dep}`)) optionalEdges.push(`${pkg.short} -> ${dep}`)
    const key = `${pkg.group}|${target.group}`
    groupEdges.set(key, (groupEdges.get(key) ?? 0) + 1)
    if (pkg.group !== target.group) crossGroup.push([pkg.group, target.group])
  }
}

const groups = [...new Set(packages.map(pkg => pkg.group))].sort()
const groupSize = new Map()
const groupPeers = new Map()
for (const pkg of packages) {
  groupSize.set(pkg.group, (groupSize.get(pkg.group) ?? 0) + 1)
  groupPeers.set(pkg.group, (groupPeers.get(pkg.group) ?? 0) + pkg.peers.length)
}

/** Tarjan strongly connected components over the peer graph. */
function stronglyConnected() {
  let index = 0
  const indices = new Map()
  const low = new Map()
  const stack = []
  const onStack = new Set()
  const out = []
  const visit = (short) => {
    indices.set(short, index)
    low.set(short, index)
    index += 1
    stack.push(short)
    onStack.add(short)
    for (const dep of byShort.get(short)?.peers ?? []) {
      if (!indices.has(dep)) {
        visit(dep)
        low.set(short, Math.min(low.get(short), low.get(dep)))
      } else if (onStack.has(dep)) {
        low.set(short, Math.min(low.get(short), indices.get(dep)))
      }
    }
    if (low.get(short) !== indices.get(short)) return
    const component = []
    let node
    do {
      node = stack.pop()
      onStack.delete(node)
      component.push(node)
    } while (node !== short)
    out.push(component)
  }
  for (const pkg of packages) if (!indices.has(pkg.short)) visit(pkg.short)
  return out.filter(component => component.length > 1).sort((a, b) => b.length - a.length)
}

const sccs = stronglyConnected()

// Dependency depth: longest path length from a package with no in-repo peers.
const depth = new Map()
const resolveDepth = (short, seen = new Set()) => {
  if (depth.has(short)) return depth.get(short)
  if (seen.has(short)) return 0
  seen.add(short)
  const peers = byShort.get(short)?.peers ?? []
  const value = peers.length === 0 ? 0 : 1 + Math.max(...peers.map(dep => resolveDepth(dep, seen)))
  seen.delete(short)
  depth.set(short, value)
  return value
}
for (const pkg of packages) resolveDepth(pkg.short)
const depthHistogram = new Map()
for (const value of depth.values()) depthHistogram.set(value, (depthHistogram.get(value) ?? 0) + 1)

const report = {
  totals: {
    packages: packages.length,
    groups: groups.length,
    peerEdges: packages.reduce((sum, pkg) => sum + pkg.peers.length, 0),
    optionalPeerEdges: optionalEdges.length,
    packagesWithoutInRepoPeers: packages.filter(pkg => pkg.peers.length === 0).length,
    packagesWithoutDependents: [...fanIn.values()].filter(value => value === 0).length,
    crossGroupEdges: crossGroup.length,
    intraGroupEdges: [...groupEdges.entries()]
      .filter(([key]) => key.split('|')[0] === key.split('|')[1])
      .reduce((sum, [, count]) => sum + count, 0),
  },
  groups: groups.map(group => ({ group, packages: groupSize.get(group), peerEdges: groupPeers.get(group) })),
  groupEdges: [...groupEdges.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split('|')
      return { from, to, count }
    })
    .sort((a, b) => b.count - a.count),
  fanIn: [...fanIn.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  fanOut: [...fanOut.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  cycles: sccs,
  depthHistogram: [...depthHistogram.entries()].sort((a, b) => a[0] - b[0]),
  optionalEdges,
  depth: Object.fromEntries([...depth.entries()].sort()),
}
writeFileSync(join(dir, 'analysis.json'), `${JSON.stringify(report, null, 2)}\n`)

console.log(JSON.stringify(report.totals, null, 2))
console.log(`cycles: ${sccs.length === 0 ? 'none' : JSON.stringify(sccs)}`)
console.log(`depth histogram: ${JSON.stringify(report.depthHistogram)}`)
