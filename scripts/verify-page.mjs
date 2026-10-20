// Validate the generated page payload and the invariants the graph relies on.
// Fails loudly with every inconsistency found, rather than the first one.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deliverableDir } from './paths.mjs'

const html = readFileSync(join(deliverableDir(), 'index.html'), 'utf8')

const start = html.indexOf('<script id="graph-data" type="application/json">')
if (start === -1) throw new Error('graph-data script block missing')
const bodyStart = html.indexOf('>', start) + 1
const bodyEnd = html.indexOf('</script>', bodyStart)
const data = JSON.parse(html.slice(bodyStart, bodyEnd))

const problems = []
const groupNames = new Set(data.groups.map(g => g.group))
const expected = { packages: 342, groups: 52, peerEdges: 973 }
if (data.totals.packages !== expected.packages) problems.push(`packages=${data.totals.packages}`)
if (data.groups.length !== expected.groups) problems.push(`groups=${data.groups.length}`)
if (data.totals.peerEdges !== expected.peerEdges) problems.push(`edges=${data.totals.peerEdges}`)

/** Every package record, flattened once. */
const allPackages = []
for (const view of data.groups) for (const pkg of view.packages) allPackages.push(pkg)
const byShort = new Map(allPackages.map(pkg => [pkg.short, pkg]))

const dependentsOf = new Map(allPackages.map(pkg => [pkg.short, 0]))
for (const pkg of allPackages) {
  for (const dep of pkg.dependencies) dependentsOf.set(dep.short, (dependentsOf.get(dep.short) ?? 0) + 1)
}

let intraTotal = 0
let outwardTotal = 0
const seen = new Set()
for (const view of data.groups) {
  intraTotal += view.intra.length
  outwardTotal += view.outward.reduce((sum, edge) => sum + edge.names.length, 0)
  for (const pkg of view.packages) {
    if (seen.has(pkg.short)) problems.push(`duplicate package ${pkg.short}`)
    seen.add(pkg.short)
    for (const dep of pkg.dependencies) {
      if (dep.group === 'missing') problems.push(`unresolved dependency ${pkg.short} -> ${dep.short}`)
    }
    if (pkg.dependents.length !== dependentsOf.get(pkg.short)) {
      problems.push(`dependents mismatch for ${pkg.short}`)
    }
  }
  for (const name of view.externalGroups) {
    if (!groupNames.has(name)) problems.push(`external group ${name} unknown in ${view.group}`)
  }
  for (const edge of view.outward) {
    if (!view.packages.some(pkg => pkg.short === edge.from)) {
      problems.push(`outward edge source ${edge.from} not in ${view.group}`)
    }
    for (const name of edge.names) {
      const target = byShort.get(name)
      if (target === undefined) problems.push(`outward target ${name} unknown`)
      else if (target.group !== edge.group) problems.push(`outward target ${name} group mismatch`)
    }
  }
  for (const edge of view.inward) {
    if (!view.packages.some(pkg => pkg.short === edge.to)) {
      problems.push(`inward edge target ${edge.to} not in ${view.group}`)
    }
    if (!groupNames.has(edge.group)) problems.push(`inward group ${edge.group} unknown`)
    for (const name of edge.names) {
      const source = byShort.get(name)
      if (source === undefined) problems.push(`inward source ${name} unknown`)
      else if (source.group !== edge.group) problems.push(`inward source ${name} group mismatch`)
    }
  }
}

if (allPackages.length !== data.totals.packages) problems.push(`walked packages=${allPackages.length}`)
if (intraTotal + outwardTotal !== data.totals.peerEdges) {
  problems.push(`edges mismatch: intra ${intraTotal} + outward ${outwardTotal} != ${data.totals.peerEdges}`)
}

/* ---------------------------------------------------------- registrations */

let tools = 0
let sections = 0
let contexts = 0
let registeringPackages = 0
let dynamicSites = 0
const toolOwners = new Map()
for (const pkg of allPackages) {
  const reg = pkg.registrations ?? { tools: [], sections: [], contexts: [] }
  tools += reg.tools.length
  sections += reg.sections.length
  contexts += reg.contexts.length
  dynamicSites += (pkg.dynamicSites ?? []).length
  if (reg.tools.length + reg.sections.length + reg.contexts.length + (pkg.dynamicSites ?? []).length > 0) {
    registeringPackages += 1
  }
  for (const tool of reg.tools) {
    if (!toolOwners.has(tool.name)) toolOwners.set(tool.name, new Set())
    toolOwners.get(tool.name).add(pkg.short)
    if (typeof tool.line !== 'number' || !tool.file.startsWith('packages/')) {
      problems.push(`tool ${tool.name} in ${pkg.short} lacks a source location`)
    }
  }
  for (const item of [...reg.sections, ...reg.contexts]) {
    if (typeof item.line !== 'number' || !item.file.startsWith('packages/')) {
      problems.push(`section ${item.name} in ${pkg.short} lacks a source location`)
    }
  }
}

for (const [key, actual, recorded] of [
  ['tools', tools, data.totals.tools],
  ['sections', sections, data.totals.sections],
  ['contexts', contexts, data.totals.contexts],
  ['registeringPackages', registeringPackages, data.totals.registeringPackages],
  ['dynamicSites', dynamicSites, data.totals.dynamicSites],
]) {
  if (actual !== recorded) problems.push(`${key}: walked ${actual} != totals ${recorded}`)
}

const overviewEdgeCount = data.overview.edges.reduce((sum, edge) => sum + edge.count, 0)
console.log(`groups=${data.groups.length} packages=${data.totals.packages} edges=${data.totals.peerEdges}`)
console.log(`intra=${intraTotal} outward=${outwardTotal} overviewEdgeCount=${overviewEdgeCount}`)
console.log(`optional=${data.totals.optionalEdges}`)
console.log(`registrations: tools=${tools} sections=${sections} contexts=${contexts} `
  + `packages=${registeringPackages} dynamic=${dynamicSites} distinctToolNames=${toolOwners.size}`)
console.log(problems.length === 0 ? 'OK: no inconsistencies' : `PROBLEMS (${problems.length}):\n${problems.slice(0, 20).join('\n')}`)
if (problems.length > 0) process.exitCode = 1
