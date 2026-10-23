// Build the slot contract map page from data/slots.json and its template.
// One self-contained HTML file: the declaration hierarchy, an index table, and
// a per-slot inspector. No slot data is written here — the page renders whatever
// extract-slots.mjs recorded.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, deliverableDir, projectPath } from './paths.mjs'

const data = JSON.parse(readFileSync(join(dataDir(), 'slots.json'), 'utf8'))
const out = deliverableDir()
mkdirSync(out, { recursive: true })

const json = JSON.stringify(data).replaceAll('<', '\\u003c')
const template = readFileSync(projectPath('src', 'slot-map.template.html'), 'utf8')
if (!template.includes('__DATA__')) throw new Error('src/slot-map.template.html: missing __DATA__ placeholder')

const html = template.replace('__DATA__', json)
writeFileSync(join(out, 'slots.html'), html)

console.log(`slots=${data.totals.slots} factories=${data.totals.factories} `
  + `html=${(readFileSync(join(out, 'slots.html')).length / 1024).toFixed(0)}KB`)
