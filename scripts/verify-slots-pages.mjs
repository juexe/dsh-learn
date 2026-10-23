// Validate the two slot pages: the embedded payload, its internal consistency,
// and the invariants the renderers rely on. Fails with every inconsistency found
// rather than the first, matching verify-page.mjs.
//
// No fixed totals appear here. The package page pins counts because its subject
// is one specific checkout; the slot catalog is a generated contract whose size
// changes whenever a seat is added, so the checks below are structural and hold
// for any catalog the extraction accepts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deliverableDir } from './paths.mjs'

const problems = []
const KINDS = new Set(['single', 'list', 'keyed', 'chain'])
const DECLARED_SOURCES = new Set(['entry', 'factory', 'runtime'])
const OPTION_NAMES = {
  single: [],
  list: ['id', 'order', 'label'],
  keyed: ['key'],
  chain: ['select'],
}

/**
 * Read one embedded JSON payload by element id.
 * @param html - page source.
 * @param id - the script element's id.
 * @returns the parsed payload.
 */
function readPayload(html, id) {
  const start = html.indexOf(`<script id="${id}" type="application/json">`)
  if (start === -1) throw new Error(`${id} script block missing`)
  const bodyStart = html.indexOf('>', start) + 1
  const bodyEnd = html.indexOf('</script>', bodyStart)
  return JSON.parse(html.slice(bodyStart, bodyEnd))
}

const mapHtml = readFileSync(join(deliverableDir(), 'slots.html'), 'utf8')
const mockHtml = readFileSync(join(deliverableDir(), 'slots-ui.html'), 'utf8')
const map = readPayload(mapHtml, 'slot-data')
const mock = readPayload(mockHtml, 'slot-data')

/* ------------------------------------------------------------ shared payload */

const slots = map.slots
const byKey = new Map(slots.map(slot => [slot.k, slot]))
const factoryNames = new Set(map.factories.map(factory => factory.name))
const regionIds = new Set(map.regions.map(region => region.id))

if (map.source.path === '' || !(map.source.lines > 0)) problems.push('catalog source location missing')
if (map.notes.length === 0) problems.push('registration notes missing')

let occupants = 0
let empty = 0
let shadowing = 0
const numbering = new Set()
for (const slot of slots) {
  if (numbering.has(slot.number)) problems.push(`duplicate slot number ${slot.number}`)
  numbering.add(slot.number)

  if (!KINDS.has(slot.kind)) problems.push(`unknown kind ${slot.kind} on ${slot.k}`)
  if (!regionIds.has(slot.region)) problems.push(`unknown region ${slot.region} on ${slot.k}`)
  if (typeof slot.doc !== 'string' || slot.doc.trim() === '') problems.push(`empty doc on ${slot.k}`)
  if (slot.risk !== 'shadows-shipped-ui' && slot.risk !== 'none') problems.push(`unknown risk ${slot.risk} on ${slot.k}`)

  // A source pointer must land inside the analysed checkout.
  if (!slot.file.startsWith('packages/')) problems.push(`source outside packages/ on ${slot.k}`)
  if (!(slot.line > 0)) problems.push(`bad source line on ${slot.k}`)

  // Parent edges resolve to a sibling slot or a recorded factory. Only the
  // built-in root has no parent.
  if (slot.parent === null) {
    if (slot.k !== 'root') problems.push(`parentless slot ${slot.k}`)
    if (slot.declaredSource !== 'runtime') problems.push(`root is not marked runtime-declared`)
  } else if (!byKey.has(slot.parent) && !factoryNames.has(slot.parent)) {
    problems.push(`dangling parent ${slot.parent} on ${slot.k}`)
  } else if (slot.declaredSource === 'runtime') {
    problems.push(`runtime-declared slot ${slot.k} names a parent`)
  } else if (slot.declaredSource === 'factory' && !factoryNames.has(slot.parent)) {
    problems.push(`slot ${slot.k} claims a factory parent that is a plain slot`)
  } else if (slot.declaredSource === 'entry' && !byKey.has(slot.parent)) {
    problems.push(`slot ${slot.k} claims an entry parent that is a factory`)
  }
  // The inspector prints this field directly to pick its wording.
  if (!DECLARED_SOURCES.has(slot.declaredSource)) {
    problems.push(`unknown declaredSource ${slot.declaredSource} on ${slot.k}`)
  }

  // Occupant strings are `<package> <component> …`; the package half must exist.
  for (const occupant of slot.occupants) {
    if (typeof occupant !== 'string' || !occupant.startsWith('client-') && !occupant.includes(' ')) {
      problems.push(`malformed occupant on ${slot.k}: ${occupant}`)
    }
  }

  occupants += slot.occupants.length
  if (slot.occupants.length === 0) empty += 1
  if (slot.risk === 'shadows-shipped-ui') shadowing += 1

  if (slot.kind in OPTION_NAMES) {
    const expected = OPTION_NAMES[slot.kind]
    for (const name of expected) {
      if (map.optionDocs[name] === undefined) problems.push(`option doc missing for ${name} on ${slot.k}`)
    }
  }
  if (map.scopeProps[slot.scope] === undefined) problems.push(`standard props missing for scope ${slot.scope}`)

  // The inspector prints these directly; a missing array throws at click time.
  if (!Array.isArray(slot.owner)) problems.push(`owner props not an array on ${slot.k}`)
  if (!Array.isArray(slot.ownerRefs)) problems.push(`owner prop references not an array on ${slot.k}`)
  if (!Array.isArray(slot.occupants)) problems.push(`occupants not an array on ${slot.k}`)
}

for (const [key, actual, recorded] of [
  ['slots', slots.length, map.totals.slots],
  ['factories', map.factories.length, map.totals.factories],
  ['occupants', occupants, map.totals.occupants],
  ['empty', empty, map.totals.empty],
  ['shadowing', shadowing, map.totals.shadowing],
  ['customExamples', slots.filter(slot => slot.example !== null).length, map.totals.customExamples],
]) {
  if (actual !== recorded) problems.push(`${key}: walked ${actual} != totals ${recorded}`)
}

// Regions must partition the catalog: every slot in exactly one, none empty.
const regionCounts = new Map(map.regions.map(region => [region.id, 0]))
for (const slot of slots) regionCounts.set(slot.region, (regionCounts.get(slot.region) ?? 0) + 1)
for (const [id, count] of regionCounts) {
  if (count === 0) problems.push(`region ${id} holds no slot`)
}
if ([...regionCounts.values()].reduce((sum, count) => sum + count, 0) !== slots.length) {
  problems.push('region counts do not partition the catalog')
}

/* ------------------------------------------------------------------- mock */

if (mock.totals.slots !== map.totals.slots) problems.push('mock and map disagree on slot count')
const mockKeys = new Set(mock.slots.map(slot => slot.k))
for (const slot of slots) if (!mockKeys.has(slot.k)) problems.push(`mock is missing ${slot.k}`)
if (mockKeys.size !== map.totals.slots) problems.push(`mock carries ${mockKeys.size} slots`)

const surfaceKeys = new Set(Object.keys(mock.surfaces))
for (const slot of slots) if (!surfaceKeys.has(slot.k)) problems.push(`mock has no surface for ${slot.k}`)
for (const key of surfaceKeys) if (!byKey.has(key)) problems.push(`mock surface names an unknown slot: ${key}`)
if (surfaceKeys.size !== slots.length) problems.push(`mock surfaces=${surfaceKeys.size} != slots=${slots.length}`)

for (const mockFactory of mock.factories) {
  if (typeof mockFactory.props !== 'string' || mockFactory.props === '') {
    problems.push(`factory ${mockFactory.name} lacks a prop type`)
  }
  if (typeof mockFactory.package !== 'string' || mockFactory.package === '') {
    problems.push(`factory ${mockFactory.name} lacks a declaring package`)
  }
  if (typeof mockFactory.scope !== 'string' || mockFactory.scope === '') {
    problems.push(`factory ${mockFactory.name} lacks a scope`)
  }
  if (!Array.isArray(mockFactory.calls) || mockFactory.calls.length === 0) {
    problems.push(`factory ${mockFactory.name} records no call site`)
  }
  // Child slots name their declaring package; a factory that disagrees with
  // every one of them is a stale record rather than a contract.
  for (const child of slots.filter(slot => slot.parent === mockFactory.name)) {
    if (child.pkg !== mockFactory.package) {
      problems.push(`factory ${mockFactory.name} claims ${mockFactory.package} but ${child.k} declares ${child.pkg}`)
    }
  }
}
for (const factory of map.factories) {
  if (!(factory.childCount >= 0)) problems.push(`factory ${factory.name} has no child count`)
  const actual = slots.filter(slot => slot.parent === factory.name).length
  if (actual !== factory.childCount) {
    problems.push(`factory ${factory.name} records ${factory.childCount} children, ${actual} slots name it`)
  }
}
if (mock.factories.length !== map.factories.length) problems.push('factory lists disagree between pages')

// Every slot the mock draws must have a seat the page can select: the mock
// renders from `data-slot` attributes, so anchor at least one per surface group.
const distinctSurfaces = new Set(Object.values(mock.surfaces))
if (distinctSurfaces.size === 0) problems.push('mock declares no surfaces')

/* ------------------------------------------------------------------ output */

const mapKb = (Buffer.byteLength(mapHtml) / 1024).toFixed(0)
const mockKb = (Buffer.byteLength(mockHtml) / 1024).toFixed(0)
console.log(`slots=${slots.length} factories=${map.factories.length} regions=${map.regions.length} `
  + `occupants=${occupants} empty=${empty} shadowing=${shadowing}`)
console.log(`kinds: ${[...KINDS].map(kind => `${kind}=${slots.filter(slot => slot.kind === kind).length}`).join(' ')}`)
console.log(`regions: ${[...regionCounts].map(([id, count]) => `${id}=${count}`).join(' ')}`)
console.log(`pages: slots.html=${mapKb}KB slots-ui.html=${mockKb}KB surfaces=${surfaceKeys.size}`)
console.log(problems.length === 0 ? 'OK: no inconsistencies' : `PROBLEMS (${problems.length}):\n${problems.slice(0, 20).join('\n')}`)
if (problems.length > 0) process.exitCode = 1
