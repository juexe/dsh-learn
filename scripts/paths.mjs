/**
 * Repository-root resolution shared by every pipeline script.
 *
 * The harness checkout being analysed is NOT this project: this project lives
 * outside the repository it inspects. The root therefore comes from, in order,
 * `--root <path>` on the command line, the `DSH_REPO_ROOT` environment
 * variable, or a `repo-root.json` file next to the scripts. Failing all three
 * is a load-time error rather than a silent fallback to a guessed path.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const projectDir = join(import.meta.dirname, '..')

/**
 * Resolve the harness checkout under analysis.
 * @returns absolute path to the repository root.
 * @throws when no configured root is a directory containing `packages/`.
 */
export function repoRoot() {
  const fromArgv = process.argv.slice(2)
  const flagIndex = fromArgv.indexOf('--root')
  const candidates = []
  if (flagIndex !== -1 && fromArgv[flagIndex + 1] !== undefined) candidates.push(fromArgv[flagIndex + 1])
  if (process.env.DSH_REPO_ROOT) candidates.push(process.env.DSH_REPO_ROOT)

  // `repo-root.local.json` is the gitignored override for a machine-specific
  // absolute path; it wins over the committed relative default.
  for (const name of ['repo-root.local.json', 'repo-root.json']) {
    const configFile = join(projectDir, name)
    if (!existsSync(configFile)) continue
    const configured = JSON.parse(readFileSync(configFile, 'utf8'))
    if (typeof configured.root === 'string') candidates.push(configured.root)
  }

  for (const candidate of candidates) {
    const absolute = isAbsolute(candidate) ? candidate : resolve(projectDir, candidate)
    if (existsSync(join(absolute, 'packages')) && existsSync(join(absolute, 'package.json'))) return absolute
    throw new Error(`dsh-learn: configured repository root has no packages/ and package.json: ${absolute}`)
  }

  throw new Error(
    'dsh-learn: no repository root configured. Pass `--root <path>`, set DSH_REPO_ROOT, '
    + `or write { "root": "<path>" } to ${join(projectDir, 'repo-root.json')}`)
}

/** Absolute path inside this project. */
export function projectPath(...segments) {
  return join(projectDir, ...segments)
}

/** Absolute path to the generated artifact directory. */
export function dataDir() {
  return projectPath('data')
}

/** Absolute path to the committed, hand-openable deliverables. */
export function deliverableDir() {
  return projectPath('deliverables')
}

export { projectDir, dirname }
