(() => {
  const out = {}
  const $ = s => document.querySelector(s)
  const $$ = s => [...document.querySelectorAll(s)]

  document.getElementById('registryBtn').click()

  const search = $('#registrySearch')
  const setQuery = q => {
    search.value = q
    search.dispatchEvent(new Event('input', { bubbles: true }))
  }

  setQuery('bash')
  out.bashRows = $$('#registryBody tr.pkgRow').map(tr => tr.children[0].textContent)
  setQuery('tool:read')
  out.sectionQuery = $$('#registryBody tr.pkgRow').map(tr => tr.children[0].textContent)
  setQuery('zzzz-no-match')
  out.emptyState = $('#registryBody').textContent.trim()
  setQuery('')
  out.restored = $$('#registryBody tr.pkgRow').length

  // A row click must open that package's group, select it, and close the view.
  const row = $$('#registryBody tr.pkgRow').find(tr => tr.children[0].textContent === 'tool-fs')
  row.click()
  out.afterRowClick = {
    registryHidden: $('#registry').hidden,
    crumbs: $('#crumbs').textContent,
    detailsTitle: ($('#details h2') || {}).textContent,
    selected: $$('#viewport .node.sel text').map(t => t.textContent),
  }
  return JSON.stringify(out)
})()
