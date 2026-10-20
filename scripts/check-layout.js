(() => {
  const items = [...document.querySelectorAll('.groupItem')].filter(el => el.dataset.group)
  const results = []
  const problems = []
  for (const item of items) {
    item.click()
    const nodes = [...document.querySelectorAll('#viewport .node')]
    const boxes = nodes.map(g => {
      const rect = g.querySelector('rect')
      const m = g.getAttribute('transform').match(/translate\(([-\d.]+),([-\d.]+)\)/)
      const text = g.querySelector('text')
      return {
        id: text.textContent,
        x: +m[1], y: +m[2],
        w: +rect.getAttribute('width'),
        h: +rect.getAttribute('height'),
        tw: text.getComputedTextLength(),
      }
    })
    let overlaps = 0
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++
      }
    }
    const clipped = boxes.filter(b => b.tw > b.w - 8).map(b => b.id)
    const edges = document.querySelectorAll('#viewport .edge').length
    results.push({ group: item.dataset.group, nodes: boxes.length, edges, overlaps, clipped: clipped.length })
    if (overlaps > 0) problems.push(`${item.dataset.group}: ${overlaps} overlaps`)
    if (clipped.length > 0) problems.push(`${item.dataset.group}: clipped ${clipped.slice(0, 4).join(',')}`)
  }
  return JSON.stringify({
    groups: results.length,
    totalNodes: results.reduce((a, b) => a + b.nodes, 0),
    problems,
    worst: results.slice().sort((a, b) => b.nodes - a.nodes).slice(0, 5),
  })
})()
