(() => {
  const out = {}
  const $ = s => document.querySelector(s)
  const $$ = s => [...document.querySelectorAll(s)]

  // Back to overview by clicking a group node in the graph.
  $('.groupItem[data-group="llm"]').click()
  out.llm = { crumbs: $('#crumbs').textContent, pkg: $$('#viewport .node.pkg').length, ext: $$('#viewport .node.group').length }

  // Sidebar navigation back to the overview, then a group node click is
  // validated separately with real mouse input (see AGENTS.md): a synthetic
  // click bypasses the canvas pointer capture and proves nothing.
  $('.groupItem[data-group=""]').click()
  out.backToOverview = { crumbs: $('#crumbs').textContent, nodes: $$('#viewport .node.group').length }

  $('.groupItem[data-group="core"]').click()

  // Optional-edge toggle inside a group view.
  const beforeOptional = $$('#viewport .edge').filter(e => e.style.display !== 'none').length
  const opt = $('#optToggle')
  opt.checked = false
  opt.dispatchEvent(new Event('change', { bubbles: true }))
  const afterOptional = $$('#viewport .edge').filter(e => e.style.display !== 'none').length
  opt.checked = true
  opt.dispatchEvent(new Event('change', { bubbles: true }))
  out.optionalToggle = { beforeOptional, afterOptional }

  // Search dims non-matching nodes.
  const search = $('#search')
  search.value = 'sandbox'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  out.search = {
    dimmed: $$('#viewport .node.dim').length,
    total: $$('#viewport .node').length,
  }
  search.value = ''
  search.dispatchEvent(new Event('input', { bubbles: true }))
  out.searchCleared = $$('#viewport .node.dim').length

  // Threshold on the overview.
  $('.groupItem[data-group=""]').click()
  const show = () => $$('#viewport .edge').filter(e => e.style.display !== 'none').length
  const all = show()
  const sel = $('#threshold')
  sel.value = '8'
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  out.threshold = { all, ge8: show(), nodes: $$('#viewport .node').length }
  sel.value = '2'
  sel.dispatchEvent(new Event('change', { bubbles: true }))

  // The registry view renders one row per registering package.
  document.getElementById('registryBtn').click()
  out.registry = {
    rows: $$('#registryBody tr.pkgRow').length,
    tools: $$('#registryBody .regChip.tool').length,
    sections: $$('#registryBody .regChip.section').length,
    contexts: $$('#registryBody .regChip.context').length,
    dynamic: $$('#registryBody .regChip.dynamic').length,
  }
  document.getElementById('registryClose').click()

  // Fit button keeps the graph inside the viewport.
  $('#fit').click()
  out.transform = $('#viewport').getAttribute('transform')

  return JSON.stringify(out)
})()
