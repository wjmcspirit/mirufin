/**
 * The library toolbar probe's own script: the head and grid a library page draws, walked with the
 * app's own navigation engine. It reports where focus landed at every press, and the geometry the
 * presses were answered from - the toolbar controls' own centres against the posters of the first
 * row - so the reported defect can be seen rather than argued about.
 *
 * `?size=small|medium|large` draws the grid at another poster size, and `?scroll=<n>` opens the
 * page already scrolled down the grid, which is what a library the viewer has walked looks like.
 *
 * `tools/foldCheck.ts` drives this page in a headless browser and asserts what comes back.
 */
;(function () {
  var params = new URLSearchParams(window.location.search)
  var size = params.get("size") || "medium"
  var scroll = Number(params.get("scroll") || 0)
  var width = window.innerWidth
  var height = window.innerHeight
  var scale = width / 1500
  var root = document.documentElement
  root.style.zoom = String(scale)
  root.style.setProperty("--app-scale", String(scale))
  root.style.setProperty("--app-height", Math.round(height / scale) + "px")

  var ART = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='360'%3E%3C/svg%3E"

  function element(tag, className, name) {
    var node = document.createElement(tag)
    node.className = className
    if (name) node.setAttribute("data-name", name)
    if (tag === "a") node.setAttribute("href", "#")
    return node
  }

  // The toolbar: the three menus and the A-Z control, in the order the page draws them.
  var icons = document.getElementById("library-icons")
  var TOOLS = [
    { label: "View", className: "tool-btn" },
    { label: "Sort", className: "tool-btn" },
    { label: "Filter", className: "tool-btn" },
    { label: "A to Z", className: "tool-btn tool-az" },
  ]
  var controls = TOOLS.map(function (tool) {
    var holder = element("div", "tool", tool.label)
    var button = element("button", tool.className, tool.label)
    button.setAttribute("type", "button")
    button.setAttribute("aria-label", tool.label)
    button.textContent = tool.label === "A to Z" ? "A–Z" : tool.label[0]
    holder.appendChild(button)
    icons.appendChild(holder)
    return button
  })

  // The grid: posters the way the library draws them, four rows of six, at the size the viewer
  // has chosen - which is the `size-*` class the page puts on the grid.
  var grid = document.getElementById("library-grid")
  grid.className = "grid poster size-" + size
  var COLUMNS = 6
  var cards = []
  for (var index = 0; index < COLUMNS * 4; index += 1) {
    var card = element("a", "card poster", "poster-" + (index + 1))
    var art = element("span", "card-art", "")
    var img = document.createElement("img")
    img.setAttribute("alt", "")
    img.setAttribute("src", ART)
    art.appendChild(img)
    var copy = element("span", "card-copy", "")
    var title = element("span", "card-title", "")
    title.textContent = "Title " + (index + 1)
    copy.appendChild(title)
    card.appendChild(art)
    card.appendChild(copy)
    grid.appendChild(card)
    cards.push(card)
  }

  var main = document.getElementById("main")
  if (scroll > 0) main.scrollTop = scroll
  var remote = window.mirufinRemote

  /** A measurement in design units, so a panel size cannot change what is being asserted. */
  function design(px) {
    return Math.round((px / (width / 1500)) * 10) / 10
  }

  /* The page as it opens, before the remote has touched it: no card is focused, so nothing is
     scaled or lifted, and the geometry the presses are answered from is the page's own. */
  var firstTop = Math.min.apply(
    null,
    cards.map(function (card) {
      return card.offsetTop
    }),
  )
  var firstRow = cards.filter(function (card) {
    return card.offsetTop === firstTop
  })
  var before = {
    tools: controls.map(function (control) {
      var box = control.getBoundingClientRect()
      return { label: control.getAttribute("aria-label"), left: design(box.left), centre: design(box.left + box.width / 2) }
    }),
    firstRow: firstRow.map(function (card) {
      var box = card.getBoundingClientRect()
      return { index: cards.indexOf(card), left: design(box.left), centre: design(box.left + box.width / 2), width: design(box.width), height: design(box.height) }
    }),
    grid: (function () {
      var box = grid.getBoundingClientRect()
      return { left: design(box.left), right: design(box.right) }
    })(),
    cardWidth: design(cards[0].getBoundingClientRect().width),
    /* The artwork inside the card, which is what a size change must not distort. */
    art: (function () {
      var box = cards[0].querySelector(".card-art").getBoundingClientRect()
      return { width: design(box.width), height: design(box.height) }
    })(),
  }
  var columns = firstRow.length

  function nextFrame() {
    return new Promise(function (done) {
      requestAnimationFrame(function () {
        requestAnimationFrame(done)
      })
    })
  }

  function where() {
    var node = document.activeElement
    if (!node || node === document.body) return { name: "body", group: "none", index: -1, left: 0 }
    var group = node.closest(".library-icons")
      ? "toolbar"
      : node.closest(".grid, .card-board")
        ? "grid"
        : node.closest(".side")
          ? "rail"
          : "other"
    return {
      name: node.getAttribute("data-name") || node.getAttribute("aria-label") || node.className,
      group: group,
      index: group === "grid" ? cards.indexOf(node) : -1,
      left: design(node.getBoundingClientRect().left),
    }
  }

  async function walk(keys) {
    var steps = []
    for (var step = 0; step < keys.length; step += 1) {
      remote.moveFocus(keys[step])
      await nextFrame()
      steps.push(where())
    }
    return steps
  }

  ;(async function () {
    // Down from every toolbar control, and back up from the poster it landed on.
    var fromToolbar = []
    var backToToolbar = []
    for (var tool = 0; tool < controls.length; tool += 1) {
      remote.placeFocus(controls[tool])
      await nextFrame()
      var down = await walk(["ArrowDown"])
      fromToolbar.push(down[0])
      var up = await walk(["ArrowUp"])
      backToToolbar.push(up[0])
    }

    // The grid itself, walked from its first poster: along the row, a row down, and back up.
    remote.placeFocus(cards[0])
    await nextFrame()
    var across = await walk(["ArrowRight", "ArrowRight"])
    var backAcross = await walk(["ArrowLeft", "ArrowLeft"])
    var downRow = await walk(["ArrowDown", "ArrowDown"])
    var upRow = await walk(["ArrowUp", "ArrowUp"])

    // The same press on a page the viewer has already scrolled down.
    if (scroll > 0) main.scrollTop = scroll
    remote.placeFocus(controls[0])
    await nextFrame()
    var scrolled = (await walk(["ArrowDown"]))[0]

    var gridBox = grid.getBoundingClientRect()
    document.getElementById("probe").textContent = JSON.stringify({
      size: size,
      scroll: scroll,
      fromToolbar: fromToolbar,
      backToToolbar: backToToolbar,
      across: across,
      backAcross: backAcross,
      downRow: downRow,
      upRow: upRow,
      scrolled: scrolled,
      page: { top: Math.round(main.scrollTop), left: Math.round(main.scrollLeft) },
      /* The geometry the presses were answered from, measured before anything was focused: the
         toolbar's controls against the first row of posters. The toolbar sits at the right of the
         header, so the poster nearest it is the last of the row and the first poster is the
         furthest from it. */
      tools: before.tools,
      firstRow: before.firstRow,
      grid: before.grid,
      cardWidth: before.cardWidth,
      art: before.art,
      rows: Math.ceil(cards.length / columns),
      columns: columns,
      gridLeft: design(gridBox.left),
    })
  })()
})()

