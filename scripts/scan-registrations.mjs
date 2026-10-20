// Scan package sources for the three registration surfaces the model sees:
// ctx.tools.register(), ctx.systemPrompt.section(), ctx.systemPrompt.context().
// Walks <root>/packages/<group>/<pkg>/src only, skipping node_modules by
// construction — this checkout's node_modules contains symlink cycles.
// Names come from a literal, a same-file constant, an imported constant, a
// same-file factory, a Config default, or template interpolation; anything
// still unresolved is reported as dynamic, never guessed.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, repoRoot } from './paths.mjs'

const root = repoRoot()
const packagesRoot = join(root, 'packages')

/** Every .ts file under one package's src tree. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const abs = join(dir, entry)
    const info = statSync(abs)
    if (info.isDirectory()) walk(abs, out)
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.d.ts')) out.push(abs)
  }
  return out
}

/** Return the source text between the '(' at openIndex and its matching ')'. */
function callBody(text, openIndex) {
  let depth = 0
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return text.slice(openIndex + 1, i)
    }
  }
  return text.slice(openIndex + 1)
}

/** First `key: <literal|identifier|template>` value inside a body. */
function nameField(body, key = 'name') {
  const match = body.match(new RegExp(`\\b${key}\\s*:\\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\\w$]*))`))
  if (!match) return null
  if (match[1] !== undefined) return { literal: match[1] }
  if (match[2] !== undefined) return { literal: match[2] }
  return { ident: match[3] }
}

/** Resolve a same-file `const NAME = 'literal'`. */
function resolveConst(text, ident) {
  const match = text.match(new RegExp(`(?:const|let)\\s+${ident}\\s*=\\s*['"]([^'"]+)['"]`))
  return match ? match[1] : null
}

/**
 * Resolve a constant imported from another in-repo package. The specifier is a
 * package NAME (`@deepseek-ai/dsh-system-prompt`), so the package directory is
 * looked up by name rather than parsed out of the path.
 */
function resolveImported(moduleRoot, text, ident) {
  const importMatch = text.match(new RegExp(`import\\s*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`))
  if (importMatch === null) return null
  const specifier = importMatch[1]
  if (!specifier.startsWith('@deepseek-ai/dsh-')) return null
  const packageName = specifier.split('/').slice(0, 2).join('/')
  for (const group of readdirSync(join(moduleRoot, 'packages'))) {
    const groupDir = join(moduleRoot, 'packages', group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const leaf of readdirSync(groupDir)) {
      const pkgDir = join(groupDir, leaf)
      try {
        if (!statSync(pkgDir).isDirectory()) continue
        const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
        if (manifest.name !== packageName) continue
        const source = readFileSync(join(pkgDir, 'src', 'index.ts'), 'utf8')
        const exported = source.match(new RegExp(`export\\s+const\\s+${ident}\\s*=\\s*['"]([^'"]+)['"]`))
        if (exported !== null) return exported[1]
      } catch { /* not a package directory, or no readable manifest/index */ }
    }
  }
  return null
}

/**
 * Resolve `const X = config.y ?? 'default'` or a destructured `config` field
 * whose Schemastery declaration carries `.default('default')` in the same file.
 * @returns the default and whether the model-visible name is config-driven.
 */
function resolveConfigDefault(text, ident) {
  const nullish = text.match(new RegExp(`(?:const|let)\\s+${ident}\\s*=\\s*[\\w.]*config\\.\\w+\\s*\\?\\?\\s*['"]([^'"]+)['"]`))
  if (nullish !== null) return { value: nullish[1], configDriven: true }
  const destructured = new RegExp(`const\\s*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s*=\\s*config`).test(text)
  if (destructured) {
    const declared = text.match(new RegExp(`\\b${ident}\\s*:\\s*z\\.\\w+\\(\\)[^,]*?\\.default\\(\\s*['"]([^'"]+)['"]`))
    if (declared !== null) return { value: declared[1], configDriven: true }
  }
  return null
}

/** Resolve a same-file factory that builds the registration (`bashTool(...)`). */
function resolveFactory(text, callExpr) {
  const identMatch = callExpr.match(/^([A-Za-z_$][\w$]*)/)
  if (identMatch === null) return null
  const declaration = text.match(new RegExp(`(?:export\\s+)?(?:function|const)\\s+${identMatch[1]}\\b`))
  if (declaration === null) return null
  const found = text.slice(declaration.index).match(/\bname:\s*['"]([^'"]+)['"]/)
  return found ? found[1] : null
}

/** Resolve a same-file method that returns a registration object with a name. */
function resolveMethod(text, methodName) {
  const match = text.match(new RegExp(`\\b${methodName}\\s*\\([^)]*\\)\\s*(?::\\s*[\\w<>[\\]]+\\s*)?\\{`))
  if (match === null) return null
  const open = match.index + match[0].length - 1
  const field = nameField(callBody(text, open))
  return field?.literal ?? null
}

/** Resolve a template name whose `${...}` placeholders all resolve. */
function resolveTemplate(text, body, moduleRoot) {
  const template = body.match(/\bname:\s*`([^`]+)`/)
  if (template === null) return null
  let resolved = template[1]
  for (const holder of [...resolved.matchAll(/\$\{([^}]+)\}/g)]) {
    const ident = holder[1].trim()
    const value = resolveConst(text, ident)
      ?? resolveImported(moduleRoot, text, ident)
      ?? resolveConfigDefault(text, ident)?.value
    if (value === null || value === undefined) return null
    resolved = resolved.replace(holder[0], value)
  }
  return resolved
}

const REGISTRATIONS = [
  { kind: 'tool', pattern: /\.tools\.register\(/g },
  { kind: 'section', pattern: /\.systemPrompt\.section\(/g },
  { kind: 'context', pattern: /\.systemPrompt\.context\(/g },
]

const records = []
const unresolved = []

for (const group of readdirSync(packagesRoot)) {
  const groupDir = join(packagesRoot, group)
  if (!statSync(groupDir).isDirectory()) continue
  for (const leaf of readdirSync(groupDir)) {
    const pkgDir = join(groupDir, leaf)
    if (!statSync(pkgDir).isDirectory()) continue
    let files
    try { files = walk(join(pkgDir, 'src')) } catch { continue }
    // Key records by the published package name, not the directory leaf:
    // `experimental/computer-use-cua-driver-native` publishes `...-computer-use-...`.
    let short = leaf
    try {
      const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
      if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/dsh-')) {
        short = manifest.name.slice('@deepseek-ai/dsh-'.length)
      }
    } catch { /* no manifest: fall back to the directory leaf */ }

    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const rel = file.slice(root.length + 1).replaceAll('\\', '/')
      for (const { kind, pattern } of REGISTRATIONS) {
        pattern.lastIndex = 0
        let match
        while ((match = pattern.exec(text)) !== null) {
          const line = text.slice(0, match.index).split('\n').length
          if (kind === 'tool') {
            const open = text.indexOf('(', match.index + match[0].length - 1)
            let body = callBody(text, open).trim()
            if (/^defineTool\s*\(/.test(body)) body = callBody(body, body.indexOf('('))
            const field = nameField(body)
            let name = field?.literal ?? null
            let configDriven = false
            if (name === null && field?.ident) {
              name = resolveConst(text, field.ident) ?? resolveImported(root, text, field.ident)
              if (name === null) {
                const fromConfig = resolveConfigDefault(text, field.ident)
                if (fromConfig !== null) {
                  name = fromConfig.value
                  configDriven = fromConfig.configDriven
                }
              }
            }
            if (name === null) name = resolveTemplate(text, body, root)
            if (name === null) name = resolveFactory(text, body)
            if (name === null) {
              const defMatch = body.match(/^([A-Za-z_$][\w$]*)$/)
              const resolved = defMatch
                ? (text.match(/defineTool\s*\(\s*\{[\s\S]*?\bname\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null)
                : null
              if (resolved === null) {
                unresolved.push({ kind, group, package: short, file: rel, line })
                continue
              }
              records.push({ kind, group, package: short, name: resolved, file: rel, line })
              continue
            }
            records.push({ kind, group, package: short, name, file: rel, line, configDriven: configDriven || null })
            continue
          }

          const open = text.indexOf('(', match.index + match[0].length - 1)
          const body = callBody(text, open)
          const field = nameField(body)
          let name = field?.literal ?? null
          if (name === null && field?.ident) {
            name = resolveConst(text, field.ident) ?? resolveImported(root, text, field.ident)
          }
          if (name === null) {
            const methodCall = body.trim().match(/^this\.([A-Za-z_$][\w$]*)\(/)
            if (methodCall) name = resolveMethod(text, methodCall[1])
          }
          if (name === null) name = resolveTemplate(text, body, root)
          if (name === null) {
            unresolved.push({ kind, group, package: short, file: rel, line })
            continue
          }
          records.push({
            kind,
            group,
            package: short,
            name,
            file: rel,
            line,
            configDriven: null,
            interpolate: /\binterpolate\s*:\s*false\b/.test(body) ? false : null,
            complete: /\bcomplete\s*:\s*true\b/.test(body) ? true : null,
          })
        }
      }
    }
  }
}

records.sort((a, b) => a.kind.localeCompare(b.kind) || a.package.localeCompare(b.package) || a.name.localeCompare(b.name))
writeFileSync(join(dataDir(), 'registrations.json'), `${JSON.stringify({ root, records, unresolved }, null, 2)}\n`)

const byKind = {}
for (const record of records) byKind[record.kind] = (byKind[record.kind] ?? 0) + 1
console.log(`root=${root}`)
console.log(`registrations: ${JSON.stringify(byKind)} total=${records.length}`)
console.log(`dynamic (name computed at runtime): ${unresolved.length}`)
for (const item of unresolved) console.log(`  ${item.file}:${item.line} ${item.kind}`)

const toolNames = new Map()
for (const record of records.filter(item => item.kind === 'tool')) {
  if (!toolNames.has(record.name)) toolNames.set(record.name, new Set())
  toolNames.get(record.name).add(record.package)
}
console.log(`distinct tool names: ${toolNames.size}`)
for (const [name, holders] of [...toolNames].sort()) {
  if (holders.size > 1) console.log(`  shared tool name ${name}: ${[...holders].join(', ')}`)
}
