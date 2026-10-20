// Build the interactive page from the extracted data and the page template.
// One self-contained HTML file: per-group dependency graphs with package-level
// nodes inside the group and group-level nodes outside it, plus the
// registration view (tools / prompt sections / runtime contexts per package).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, deliverableDir, projectPath } from './paths.mjs'

const dir = dataDir()
const out = deliverableDir()
mkdirSync(out, { recursive: true })

const { packages } = JSON.parse(readFileSync(join(dir, 'packages.json'), 'utf8'))
const byShort = new Map(packages.map(pkg => [pkg.short, pkg]))
const PREFIX = '@deepseek-ai/dsh-'
const isOptional = (pkg, dep) => pkg.optionalPeers.includes(`${PREFIX}${dep}`)

const groups = new Map()
for (const pkg of packages) {
  if (!groups.has(pkg.group)) groups.set(pkg.group, [])
  groups.get(pkg.group).push(pkg)
}
for (const members of groups.values()) members.sort((a, b) => a.short.localeCompare(b.short))

/** Aggregated package -> external group edges for one group view. */
function outEdges(group) {
  const map = new Map()
  for (const pkg of groups.get(group)) {
    for (const dep of pkg.peers) {
      const target = byShort.get(dep)
      if (target === undefined || target.group === group) continue
      const key = `${pkg.short}\u0000${target.group}`
      const entry = map.get(key) ?? { from: pkg.short, group: target.group, names: [], optional: 0 }
      entry.names.push(dep)
      if (isOptional(pkg, dep)) entry.optional += 1
      map.set(key, entry)
    }
  }
  return [...map.values()]
    .map(entry => ({ ...entry, names: entry.names.sort() }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.group.localeCompare(b.group))
}

/** Aggregated external group -> package edges pointing into one group. */
function inEdges(group) {
  const members = new Set(groups.get(group).map(pkg => pkg.short))
  const map = new Map()
  for (const pkg of packages) {
    if (pkg.group === group) continue
    for (const dep of pkg.peers) {
      if (!members.has(dep)) continue
      const key = `${pkg.group}\u0000${dep}`
      const entry = map.get(key) ?? { group: pkg.group, to: dep, names: [], optional: 0 }
      entry.names.push(pkg.short)
      if (isOptional(pkg, dep)) entry.optional += 1
      map.set(key, entry)
    }
  }
  return [...map.values()]
    .map(entry => ({ ...entry, names: entry.names.sort() }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.to.localeCompare(b.to))
}

const registrationScan = JSON.parse(readFileSync(join(dir, 'registrations.json'), 'utf8'))
/** Registrations keyed by package short name, deduplicated per kind. */
const registrationsByPackage = new Map()
for (const record of registrationScan.records) {
  if (!registrationsByPackage.has(record.package)) {
    registrationsByPackage.set(record.package, { tools: [], sections: [], contexts: [] })
  }
  const bucket = registrationsByPackage.get(record.package)
  const key = record.kind === 'tool' ? 'tools' : record.kind === 'section' ? 'sections' : 'contexts'
  if (bucket[key].some(item => item.name === record.name)) continue
  bucket[key].push({
    name: record.name,
    file: record.file,
    line: record.line,
    configDriven: record.configDriven === true,
    interpolate: record.interpolate === false,
    complete: record.complete === true,
  })
}
/** Registrations whose names only exist at runtime (MCP servers, config-driven). */
const dynamicSites = registrationScan.unresolved.map(item => ({
  kind: item.kind,
  package: item.package,
  file: item.file,
  line: item.line,
}))

const groupViews = []
for (const [group, members] of [...groups.entries()]
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
  const intra = []
  for (const pkg of members) {
    for (const dep of pkg.peers) {
      const target = byShort.get(dep)
      if (target?.group !== group) continue
      intra.push({ from: pkg.short, to: dep, optional: isOptional(pkg, dep) })
    }
  }
  const outward = outEdges(group)
  const inward = inEdges(group)
  const externalGroups = new Set([...outward.map(edge => edge.group), ...inward.map(edge => edge.group)])
  groupViews.push({
    group,
    packages: members.map(pkg => ({
      short: pkg.short,
      group: pkg.group,
      name: pkg.name,
      version: pkg.version,
      path: pkg.rel,
      description: pkg.description,
      fanIn: packages.filter(other => other.peers.includes(pkg.short)).length,
      fanOut: pkg.peers.length,
      registrations: registrationsByPackage.get(pkg.short) ?? { tools: [], sections: [], contexts: [] },
      dynamicSites: dynamicSites.filter(site => site.package === pkg.short),
      dependencies: pkg.peers.map(dep => ({
        short: dep,
        group: byShort.get(dep)?.group ?? 'missing',
        optional: isOptional(pkg, dep),
      })),
      dependents: packages
        .filter(other => other.peers.includes(pkg.short))
        .map(other => ({ short: other.short, group: other.group, optional: isOptional(other, pkg.short) }))
        .sort((a, b) => a.short.localeCompare(b.short)),
    })),
    intra,
    outward,
    inward,
    externalGroups: [...externalGroups].sort(),
  })
}

/* Group-level overview: one node per group, edges aggregated over packages. */
const groupIndex = new Map(groupViews.map((view, index) => [view.group, index]))
const overviewEdges = new Map()
for (const pkg of packages) {
  for (const dep of pkg.peers) {
    const target = byShort.get(dep)
    if (target === undefined || target.group === pkg.group) continue
    const key = `${pkg.group}\u0000${target.group}`
    const entry = overviewEdges.get(key)
      ?? { from: groupIndex.get(pkg.group), to: groupIndex.get(target.group), names: [], count: 0 }
    entry.names.push(`${pkg.short}→${dep}`)
    entry.count += 1
    overviewEdges.set(key, entry)
  }
}

const allRegistrations = [...registrationsByPackage.values()]
const data = {
  totals: {
    packages: packages.length,
    groups: groupViews.length,
    peerEdges: packages.reduce((sum, pkg) => sum + pkg.peers.length, 0),
    optionalEdges: packages.reduce(
      (sum, pkg) => sum + pkg.peers.filter(dep => isOptional(pkg, dep)).length, 0),
    tools: allRegistrations.reduce((sum, item) => sum + item.tools.length, 0),
    sections: allRegistrations.reduce((sum, item) => sum + item.sections.length, 0),
    contexts: allRegistrations.reduce((sum, item) => sum + item.contexts.length, 0),
    // Counted per registered package, including one whose only record is a
    // dynamically-named registration — the rule the registry view renders by.
    registeringPackages: groupViews.reduce((sum, view) => sum + view.packages.filter(pkg =>
      pkg.registrations.tools.length + pkg.registrations.sections.length + pkg.registrations.contexts.length
      + pkg.dynamicSites.length > 0).length, 0),
    dynamicSites: dynamicSites.length,
  },
  groups: groupViews,
  overview: {
    nodes: groupViews.map((view, index) => ({
      index,
      group: view.group,
      size: view.packages.length,
      fanOut: view.outward.reduce((sum, edge) => sum + edge.names.length, 0),
      fanIn: view.inward.reduce((sum, edge) => sum + edge.names.length, 0),
    })),
    edges: [...overviewEdges.values()].map(entry => ({
      from: entry.from,
      to: entry.to,
      count: entry.count,
      names: entry.names.sort(),
    })),
  },
}

const json = JSON.stringify(data).replaceAll('<', '\\u003c')
const template = readFileSync(projectPath('src', 'page.template.html'), 'utf8')
if (!template.includes('__DATA__')) throw new Error('src/page.template.html: missing __DATA__ placeholder')
writeFileSync(join(out, 'index.html'), template.replace('__DATA__', json))

const bytes = readFileSync(join(out, 'index.html')).length
console.log(`groups=${groupViews.length} packages=${packages.length} `
  + `edges=${data.totals.peerEdges} html=${(bytes / 1024).toFixed(0)}KB`)
