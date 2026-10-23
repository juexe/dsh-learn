// Build the interactive Web GUI slot mock from data/slots.json and its template.
//
// One thing is added here rather than extracted: the surface each slot is drawn
// on. That is a fact about the mock's own layout — which DOM seat stands in for
// each SlotMap key — so it lives with the build that consumes it, not in the
// shared extraction payload.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, deliverableDir, projectPath } from './paths.mjs'

const data = JSON.parse(readFileSync(join(dataDir(), 'slots.json'), 'utf8'))
const out = deliverableDir()
mkdirSync(out, { recursive: true })

/** Which mock surface draws each slot's hotspot. */
const SURFACES = {
  root: 'frame',
  main: 'main',
  'main.conversation': 'conv-root',
  'conversation.session': 'conv-body',
  'conversation.header': 'conv-header',
  'conversation.session.header': 'conv-header',
  'conversation.session.header.lineage': 'header-title',
  'conversation.session.header.actions': 'header-actions',
  'conversation.session.header.utilities': 'header-utilities',
  'conversation.session.header.corner': 'header-corner',
  'conversation.header.leading': 'header-leading',
  'conversation.view': 'view-tabs',
  'conversation.chat.flow': 'chat-flow',
  'conversation.chat.node': 'chat-node',
  'conversation.chat.assistant-actions': 'assistant-actions',
  'conversation.chat.commandview': 'chat-node',
  'conversation.chat.message.images': 'assistant-images',
  'conversation.chat.reasoning.body': 'reasoning',
  'conversation.chat.turnTail': 'turn-tail',
  'conversation.chat.user.images': 'user-images',
  'conversation.composer': 'composer-chain',
  'conversation.composer.bar': 'composer-bar',
  'conversation.composer.dock': 'composer-dock-below',
  'conversation.input.dock': 'composer-dock-above',
  'conversation.input.overlay': 'composer-overlay',
  'conversation.input.left': 'composer-left',
  'conversation.input.right': 'composer-right',
  'conversation.input.activity': 'composer-activity',
  'conversation.input.attachments': 'composer-attachments',
  'conversation.input.plan': 'composer-plan',
  'conversation.input.permission': 'composer-permission',
  'conversation.input.model': 'composer-model',
  'conversation.input.model.label': 'composer-model-label',
  'conversation.approval.detail': 'approval-detail',
  'conversation.plan-review.actions': 'plan-review',
  'conversation.hero.agentPreset': 'hero-preset',
  'conversation.hero.brand.mark': 'hero-brand',
  'conversation.hero.workspace': 'hero-workspace',
  'conversation.hero.workspace.directoryFlow': 'hero-workspace-flow',
  'conversation.hero.options': 'hero-options',
  'conversation.trajectory.images': 'trajectory-images',
  'conversation.user.text.node': 'user-text',
  sidebar: 'sidebar-root',
  'sidebar.brand.mark': 'sidebar-brand',
  'sidebar.brand.name': 'sidebar-brand',
  'sidebar.settings': 'sidebar-footer',
  'sidebar.footer.action': 'sidebar-footer',
  'sidebar.panellist': 'sidebar-panels',
  'sidebar.toggle.badge': 'sidebar-toggle',
  'sidebar.workspaces': 'sidebar-workspaces',
  'sidebar.workspaces.directoryFlow': 'sidebar-workspace-flow',
  'sidebar.workspaces.session.menu.item': 'session-menu',
  'sidebar.workspaces.session.row.action': 'session-row-actions',
  'sidebar.session.row.hover': 'session-row-hover',
  'sidebar.session.row.leading': 'session-row-leading',
  rightbar: 'rightbar-root',
  'rightbar.session': 'rightbar-session',
  'sidebar.right.pane.tab': 'rightbar-tabs',
  'sidebar.right.pane.tab.title': 'rightbar-tabs',
  'sidebar.right.tab.menu.item': 'rightbar-tab-menu',
  'sidebar.right.tab.document': 'doc-body',
  'sidebar.right.tab.document.action': 'doc-actions',
  'sidebar.right.tab.document.actions': 'doc-actions',
  'sidebar.right.tab.document.office.pdf': 'doc-pdf',
  'sidebar.right.tab.document.unpreviewable': 'doc-unpreviewable',
  'sidebar.right.tab.files.actions': 'files-actions',
  'sidebar.right.tab.guide': 'guide-tab',
  'sidebar.right.tab.guide.entry': 'guide-entry',
  'sidebar.chat.conversation': 'rightbar-chat',
  'tool.call.toolview': 'tool-row',
  'tool.call.images': 'tool-images',
  'tool.view.cordis': 'tool-cordis',
  'deliverables.file.actions': 'turn-tail',
  'deliverables.review.file.actions': 'files-actions',
  'settings.section': 'settings-nav',
  'settings.general.item': 'settings-general',
  'settings.header': 'settings-header',
  'settings.close': 'settings-header',
  'settings.action': 'settings-header',
  'settings.launcher': 'settings-header',
  'settings.trigger': 'settings-nav',
  'settings.onboarding': 'settings-nav',
  'settings.models.footer': 'settings-models',
  'settings.models.provider-card': 'settings-models',
  'settings.models.sign-in': 'settings-models',
  'settings.plugins.tab': 'settings-plugin-tabs',
  'plugins.tab': 'plugins-tabs',
  'plugins.item': 'plugins-list',
  'plugins.row.config': 'plugins-list',
  'plugins.detail.section': 'plugins-detail',
  'plugins.detail.actions': 'plugins-detail',
  'plugins.detail.badge': 'plugins-detail',
  'plugins.add.actions': 'plugins-add',
  'plugins.bundle.config': 'plugins-detail',
  'plugins.bundle.activation': 'plugins-detail',
  'shell.overlay': 'overlay-layer',
  'shell.bottom': 'shell-bottom',
  'shell.leading': 'shell-leading',
  'shell.quota-notice': 'overlay-layer',
  'workspace.toast': 'toast-layer',
}

/** Factory prop types live in data/slots.json; this build only checks them. */
const problems = []
const slotKeys = new Set(data.slots.map(slot => slot.k))
for (const slot of data.slots) {
  if (!(slot.k in SURFACES)) problems.push(`no mock surface for ${slot.k}`)
}
for (const key of Object.keys(SURFACES)) {
  if (!slotKeys.has(key)) problems.push(`surface names an unknown slot: ${key}`)
}
for (const factory of data.factories) {
  if (typeof factory.props !== 'string' || factory.props === '') {
    problems.push(`factory ${factory.name} carries no prop type`)
  }
}
if (problems.length > 0) {
  console.error(problems.slice(0, 20).join('\n'))
  throw new Error(`dsh-learn: ${problems.length} mock surface assumptions failed`)
}

const payload = { ...data, surfaces: SURFACES }
const json = JSON.stringify(payload).replaceAll('<', '\\u003c')
const template = readFileSync(projectPath('src', 'slot-mock.template.html'), 'utf8')
if (!template.includes('__DATA__')) throw new Error('src/slot-mock.template.html: missing __DATA__ placeholder')

const html = template.replace('__DATA__', json)
writeFileSync(join(out, 'slots-ui.html'), html)

console.log(`slots=${payload.totals.slots} surfaces=${Object.keys(SURFACES).length} `
  + `html=${(readFileSync(join(out, 'slots-ui.html')).length / 1024).toFixed(0)}KB`)
