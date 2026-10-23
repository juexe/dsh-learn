// Extract the shipped Web bundle's slot contract into data/slots.json.
//
// The catalog is a generated TypeScript module inside the analysed checkout, so
// this reads it as a module instead of parsing it: its exported arrays are the
// contract, and re-deriving them with a regular expression would silently drift.
// Everything the two rendered pages share is normalised here; anything one page
// alone needs (the mock's surface placement) stays in that page's build script.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dataDir, repoRoot } from './paths.mjs'

const CATALOG = join(
  repoRoot(),
  'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts',
)

/** Load the generated catalog module, reporting a clear error if it moves. */
async function loadCatalog() {
  try {
    return await import(pathToFileURL(CATALOG).href)
  } catch (error) {
    throw new Error(
      `dsh-learn: cannot load the slot catalog at ${CATALOG}. `
      + 'The path is part of the analysed checkout; re-point repo-root.json or update '
      + 'scripts/extract-slots.mjs when upstream moves the generated catalog.\n'
      + `cause: ${error.message}`,
    )
  }
}

const { CLIENT_NOTES, CLIENT_SLOT_API } = await loadCatalog()
if (!Array.isArray(CLIENT_SLOT_API) || !Array.isArray(CLIENT_NOTES)) {
  throw new Error('dsh-learn: slot catalog does not export CLIENT_SLOT_API and CLIENT_NOTES arrays')
}

/**
 * Which surface of the Web GUI a slot belongs to. Derived from the key so both
 * pages group and label slots identically; `sidebar.right.*` is a right-panel
 * key despite living under the sidebar namespace.
 * @param key - SlotMap key.
 * @returns the region id.
 */
function regionOf(key) {
  if (key === 'root' || key === 'main' || key.startsWith('shell.')) return 'shell'
  if (key === 'sidebar' || (key.startsWith('sidebar.') && !key.startsWith('sidebar.right.'))) return 'sidebar'
  if (key === 'rightbar' || key.startsWith('rightbar.') || key.startsWith('sidebar.right.')) return 'rightbar'
  if (key.startsWith('conversation.') || key === 'main.conversation') return 'conversation'
  if (key.startsWith('tool.')) return 'tool'
  if (key.startsWith('settings.')) return 'settings'
  if (key.startsWith('plugins.')) return 'plugins'
  if (key.startsWith('workspace.') || key.startsWith('deliverables.')) return 'workspace'
  return ''
}

const REGIONS = [
  { id: 'shell', label: '框架' },
  { id: 'sidebar', label: '侧边栏' },
  { id: 'rightbar', label: '右侧面板' },
  { id: 'conversation', label: '会话区' },
  { id: 'tool', label: '工具调用' },
  { id: 'settings', label: '设置' },
  { id: 'plugins', label: '插件管理' },
  { id: 'workspace', label: '工作区' },
]

/** Register options repeat verbatim per cardinality; keep one documented copy. */
const OPTION_ORDER = { single: [], list: ['id', 'order', 'label'], keyed: ['key'], chain: ['select'] }
const optionDocs = {}
const scopeProps = {}
const problems = []

/** Examples follow kind + key except where the catalog supplies a richer one. */
function generatedExample(slot) {
  const options = [`name: '${slot.k}'`]
  if (slot.kind === 'keyed') options.push("key: '<one key the owner dispatches>'")
  if (slot.kind === 'list') options.push("id: 'my-entry'", 'order: 100', "label: 'My entry'")
  if (slot.kind === 'chain') options.push('select: owner => null')
  return `return {\n  inject: ['slots'],\n  apply(ctx) {\n    ctx.slots.inject('${slot.k}', () => ctx.slots.register(\n`
    + `      { ${options.join(', ')} },\n      () => React.createElement('div', null, 'hello'),\n    ))\n  },\n}`
}

/** Split `an entry in 'x' (pkg), so it exists while that entry is mounted`. */
function parseDeclaredBy(text) {
  const entry = /^an entry in '([^']+)' \((.+)\), so it exists while that entry is mounted$/.exec(text)
  if (entry) return { source: 'entry', parent: entry[1], pkg: entry[2] }
  const factory = /^factory '([^']+)' \((.+)\), so it exists while that definition is registered$/.exec(text)
  if (factory) return { source: 'factory', parent: factory[1], pkg: factory[2] }
  const runtime = /^the runtime itself \((.+)\)$/.exec(text)
  if (runtime) return { source: 'runtime', parent: null, pkg: runtime[1] }
  problems.push(`unparsed declaredBy: ${text}`)
  return { source: 'unknown', parent: null, pkg: '' }
}

const slots = CLIENT_SLOT_API.map((entry, index) => {
  const declared = parseDeclaredBy(entry.declaredBy)
  const colon = entry.source.lastIndexOf(':')

  if (JSON.stringify(entry.registerOptions.map(option => option.name)) !== JSON.stringify(OPTION_ORDER[entry.kind])) {
    problems.push(`register options drifted from cardinality on ${entry.key}`)
  }
  for (const option of entry.registerOptions) {
    const record = { requirement: option.requirement, type: option.type, doc: option.doc }
    const known = optionDocs[option.name]
    if (known === undefined) optionDocs[option.name] = record
    else if (JSON.stringify(known) !== JSON.stringify(record)) {
      problems.push(`option doc differs between slots on ${option.name}`)
    }
  }
  if (scopeProps[entry.scope] === undefined) scopeProps[entry.scope] = entry.standardProps
  else if (JSON.stringify(scopeProps[entry.scope]) !== JSON.stringify(entry.standardProps)) {
    problems.push(`standard props differ within scope ${entry.scope} (${entry.key})`)
  }

  const region = regionOf(entry.key)
  if (region === '') problems.push(`no region for ${entry.key}`)

  const slot = {
    k: entry.key,
    number: index + 1,
    kind: entry.kind,
    scope: entry.scope,
    doc: entry.doc,
    summary: entry.summary,
    owner: entry.ownerProps,
    ownerRefs: entry.ownerPropsReferences,
    keyDomain: entry.keyDomain,
    hookContext: entry.hookContext,
    slotInject: entry.slotInject,
    declared: entry.declaredBy,
    declaredSource: declared.source,
    parent: declared.parent,
    pkg: declared.pkg,
    occupants: entry.occupants,
    risk: entry.replaceRisk,
    region,
    file: entry.source.slice(0, colon),
    line: Number(entry.source.slice(colon + 1)),
    example: generatedExample({ k: entry.key, kind: entry.kind }) === entry.example ? null : entry.example,
  }
  if (!Number.isFinite(slot.line) || slot.line < 1) problems.push(`bad source line on ${entry.key}`)
  return slot
})

/* Reusable factories are not slots: they hold child declarations for the life
   of their registered definition. Their scope, prop type and declaring package
   come from the `SlotFactoryMap` declarations in the client contracts, which the
   generated catalog does not carry; call sites are read from renderFactorySlot. */
const FACTORY_META = {
  'conversation.content': {
    scope: 'session-maybe',
    props: 'ConversationContentInputProps',
    package: 'client-ui-conversation',
    calls: [
      ['packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx', 48],
      ['packages/client/ui-subagent/src/client/sidebar-chat/index.tsx', 145],
    ],
  },
  'conversation.chat.user.content': {
    scope: 'session',
    props: 'UserContentInput',
    package: 'client-ui-chat',
    calls: [['packages/client/ui-chat/src/client/chat/MessageItem.tsx', 203]],
  },
  'conversation.user.text': {
    scope: 'session',
    props: 'UserTextInput',
    package: 'client-ui-conversation',
    calls: [
      ['packages/client/ui-chat/src/client/chat/UserContent.tsx', 48],
      ['packages/client/ui-conversation/src/client/queue/QueueDock.tsx', 230],
      ['packages/client/ui-conversation/src/client/queue/QueueDock.tsx', 347],
      ['packages/client/ui-goal/src/client/GoalCommandInputView.tsx', 32],
    ],
  },
  'conversation.chat.reasoning.content': {
    scope: 'root',
    props: 'ReasoningContentInput',
    package: 'client-ui-chat',
    calls: [['packages/client/ui-chat/src/client/chat/ReasoningContent.tsx', 25]],
  },
  'conversation.images.content': {
    scope: 'root',
    props: 'MessageImagesContentInput',
    package: 'client-ui-conversation',
    calls: [['packages/client/ui-attachment/src/client/MessageImages.tsx', 28]],
  },
}

const factories = Object.entries(FACTORY_META).map(([name, meta]) => {
  const children = slots.filter(slot => slot.parent === name)
  // A factory may declare no registrable seat — `conversation.chat.reasoning.content`
  // and `conversation.images.content` are reusable markup with no child slot. That
  // is a contract of the catalog, not a gap, so the count is recorded as-is.
  // Every child names its declaring package, so a drifted factory record fails here.
  for (const child of children) {
    if (child.pkg !== meta.package) {
      problems.push(`factory ${name} claims ${meta.package} but ${child.k} declares ${child.pkg}`)
    }
  }
  if (meta.calls.length === 0) problems.push(`factory ${name} records no call site`)
  return { name, ...meta, childCount: children.length }
})

const factoryNames = new Set(factories.map(factory => factory.name))
const slotKeys = new Set(slots.map(slot => slot.k))
for (const slot of slots) {
  if (slot.parent === null) continue
  if (!slotKeys.has(slot.parent) && !factoryNames.has(slot.parent)) {
    problems.push(`dangling parent ${slot.parent} on ${slot.k}`)
  }
}

if (problems.length > 0) {
  console.error(problems.slice(0, 20).join('\n'))
  throw new Error(`dsh-learn: ${problems.length} slot catalog assumptions failed`)
}

const sourceLines = readFileSync(CATALOG, 'utf8').split('\n').length
const payload = {
  source: {
    path: relative(repoRoot(), CATALOG).split('\\').join('/'),
    lines: sourceLines,
  },
  notes: CLIENT_NOTES,
  optionDocs,
  scopeProps,
  regions: REGIONS,
  slots,
  factories,
  totals: {
    slots: slots.length,
    factories: factories.length,
    occupants: slots.reduce((sum, slot) => sum + slot.occupants.length, 0),
    empty: slots.filter(slot => slot.occupants.length === 0).length,
    shadowing: slots.filter(slot => slot.risk === 'shadows-shipped-ui').length,
    customExamples: slots.filter(slot => slot.example !== null).length,
  },
}

const dir = dataDir()
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'slots.json'), `${JSON.stringify(payload, null, 1)}\n`)

const byRegion = {}
for (const slot of slots) byRegion[slot.region] = (byRegion[slot.region] ?? 0) + 1
console.log(`slots=${payload.totals.slots} factories=${payload.totals.factories} `
  + `occupants=${payload.totals.occupants} empty=${payload.totals.empty} `
  + `shadowing=${payload.totals.shadowing}`)
console.log(`regions: ${REGIONS.map(region => `${region.label}=${byRegion[region.id] ?? 0}`).join(' ')}`)
console.log(`catalog=${payload.source.path} lines=${payload.source.lines}`)
