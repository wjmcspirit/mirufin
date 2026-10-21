/**
 * The remote timing probe's own script.
 *
 * It draws a page as heavy as the busiest screen the app has, walks it with the app's own
 * navigation engine, and reports two different things about every press:
 *
 *  - the wall-clock time from `moveFocus` to the focus being on the right control, and on to the
 *    next painted frame. Those numbers are this machine's and are reported for the record;
 *  - the DOM work the engine did to get there, counted by instrumenting `querySelectorAll`,
 *    `getBoundingClientRect`, `getComputedStyle` and `focus` for the duration of the press. Those
 *    counts are the same on any machine, so they are what the checks assert.
 *
 * `?cards=` sets how many posters the grid holds, so the same walk is measured on a small page and
 * a large one: a press that costs more on the large page is a press whose cost grows with the page.
 *
 * `tools/foldCheck.ts` drives this page at 1080p, 1440p and 4K.
 */
;(function () {
  var params = new URLSearchParams(window.location.search)
  var GRID_CARDS = Math.max(6, Number(params.get("cards") || 24))
  var STRIP_CARDS = 24
  var width = window.innerWidth
  var height = window.innerHeight
  var scale = width / 1500
  var root = document.documentElement
  root.style.zoom = String(scale)
  root.style.setProperty("--app-scale", String(scale))
  root.style.setProperty("--app-height", Math.round(height / scale) + "px")

  var ART = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='168' height='252'%3E%3C/svg%3E"

  function element(tag, className, name) {
    var node = document.createElement(tag)
    node.className = className
    if (name) node.setAttribute("data-name", name)
    if (tag === "a") node.setAttribute("href", "#")
    return node
  }

  function art(className) {
    var box = element("span", className, "")
    var img = document.createElement("img")
    img.setAttribute("alt", "")
    img.setAttribute("src", ART)
    box.appendChild(img)
    return box
  }

  function card(name, className, label) {
    var node = element("a", className, name)
    node.appendChild(art("card-art"))
    var copy = element("span", "card-copy", "")
    var title = element("span", "card-title", "")
    title.textContent = label
    copy.appendChild(title)
    node.appendChild(copy)
    return node
  }

  // The hero's own actions, a stack: Down walks them and leaves the row at its end.
  var heroActions = document.getElementById("hero-actions")
  ;["Play", "Details", "Favorite", "Trailers"].forEach(function (label, index) {
    var button = element(index === 0 ? "a" : "button", index === 0 ? "btn btn-primary" : "btn icon-btn", "hero-" + label.toLowerCase())
    button.textContent = label
    if (index === 0) button.setAttribute("href", "#")
    heroActions.appendChild(button)
  })

  // The library's toolbar: four controls at the right of the head.
  var icons = document.getElementById("library-icons")
  ;["View", "Sort", "Filter", "A to Z"].forEach(function (label) {
    var holder = element("div", "tool", "")
    var button = element("button", "tool-btn", "tool-" + label.toLowerCase().replace(/ /g, "-"))
    button.setAttribute("type", "button")
    button.setAttribute("aria-label", label)
    button.textContent = label === "A to Z" ? "A–Z" : label[0]
    holder.appendChild(button)
    icons.appendChild(holder)
  })

  // A wide strip of cards: the row every screen draws, and the one whose sideways scrolling the
  // remote drives.
  var strip = document.getElementById("strip")
  var stripCards = []
  for (var index = 0; index < STRIP_CARDS; index += 1) {
    var stripCard = card("strip-" + (index + 1), "card poster", "Strip " + (index + 1))
    strip.appendChild(stripCard)
    stripCards.push(stripCard)
  }

  // The grid: the page's main event, and the part that grows with the library.
  var grid = document.getElementById("grid")
  var gridCards = []
  for (var index = 0; index < GRID_CARDS; index += 1) {
    var gridCard = card("grid-" + (index + 1), "card poster", "Poster " + (index + 1))
    grid.appendChild(gridCard)
    gridCards.push(gridCard)
  }

  var remote = window.mirufinRemote
  var main = document.getElementById("main")

  // ---------------------------------------------------------------- the instruments
  //
  // Four calls decide what a press costs the page: finding the controls, measuring them, asking
  // whether each one is visible, and moving focus. Each is counted for the duration of one press,
  // so the report says what the engine asked of the DOM rather than how fast this machine is.
  var counts = { queries: 0, nodes: 0, rects: 0, styles: 0, focuses: 0, writes: 0, forced: 0, forcedAt: [] }
  var dirty = false
  var queryAll = Document.prototype.querySelectorAll
  var elementQueryAll = Element.prototype.querySelectorAll
  var rectOf = Element.prototype.getBoundingClientRect
  var computedStyle = window.getComputedStyle
  var focusOf = HTMLElement.prototype.focus
  var tokenAdd = DOMTokenList.prototype.add
  var tokenRemove = DOMTokenList.prototype.remove
  var scrollTopOf = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")
  var scrollLeftOf = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft")

  /** A read of geometry: the browser lays the page out again if anything was changed since the last. */
  function read() {
    counts.rects += 1
    if (dirty) {
      counts.forced += 1
      dirty = false
      if (counts.forcedAt.length < 8) counts.forcedAt.push(callSite())
    }
  }

  /** Where a forced layout was asked for, by the engine's own function name. */
  function callSite() {
    var stack = String((new Error().stack) || "").split("\n")
    for (var index = 1; index < stack.length; index += 1) {
      var line = stack[index]
      if (line.indexOf("remoteProbe.js") < 0) continue
      var named = /at ([A-Za-z0-9_$.]+) \(/.exec(line)
      if (named) return named[1]
      return line.trim().slice(0, 48)
    }
    return "?"
  }

  /** A change to the page that geometry would have to be measured again for. */
  function write() {
    counts.writes += 1
    dirty = true
  }

  Document.prototype.querySelectorAll = function (selector) {
    var found = queryAll.call(this, selector)
    counts.queries += 1
    counts.nodes += found.length
    return found
  }
  Element.prototype.querySelectorAll = function (selector) {
    var found = elementQueryAll.call(this, selector)
    counts.queries += 1
    counts.nodes += found.length
    return found
  }
  Element.prototype.getBoundingClientRect = function () {
    read()
    return rectOf.call(this)
  }
  window.getComputedStyle = function (node, pseudo) {
    counts.styles += 1
    return computedStyle.call(window, node, pseudo)
  }
  HTMLElement.prototype.focus = function (options) {
    counts.focuses += 1
    write()
    return focusOf.call(this, options)
  }
  DOMTokenList.prototype.add = function () {
    write()
    return tokenAdd.apply(this, arguments)
  }
  DOMTokenList.prototype.remove = function () {
    write()
    return tokenRemove.apply(this, arguments)
  }
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get: function () {
      read()
      return scrollTopOf.get.call(this)
    },
    set: function (value) {
      write()
      scrollTopOf.set.call(this, value)
    },
  })
  Object.defineProperty(Element.prototype, "scrollLeft", {
    configurable: true,
    get: function () {
      read()
      return scrollLeftOf.get.call(this)
    },
    set: function (value) {
      write()
      scrollLeftOf.set.call(this, value)
    },
  })

  function reset() {
    counts.queries = 0
    counts.nodes = 0
    counts.rects = 0
    counts.styles = 0
    counts.focuses = 0
    counts.writes = 0
    counts.forced = 0
    counts.forcedAt = []
    dirty = false
  }

  function nextFrame() {
    return new Promise(function (done) {
      requestAnimationFrame(function () {
        requestAnimationFrame(done)
      })
    })
  }

  /** Which control holds focus, by the name the probe gave it. */
  function focused() {
    var node = document.activeElement
    if (!node || !node.getAttribute) return "body"
    return node.getAttribute("data-name") || node.className
  }

  /**
   * One press, measured: what it cost the DOM, how long the engine took, and how long the frame
   * that carried the change took to be painted. The frame figure has a floor of one frame - the
   * callback the probe waits for runs before that frame is painted - so 16.7ms at 60Hz means the
   * press was painted in the very next frame.
   */
  async function press(key) {
    reset()
    var before = performance.now()
    remote.moveFocus(key)
    var after = performance.now()
    var cost = {
      key: key,
      landed: focused(),
      ms: Math.round((after - before) * 1000) / 1000,
      queries: counts.queries,
      nodes: counts.nodes,
      rects: counts.rects,
      styles: counts.styles,
      focuses: counts.focuses,
      writes: counts.writes,
      forced: counts.forced,
      forcedAt: counts.forcedAt.slice(),
    }
    await new Promise(function (done) {
      requestAnimationFrame(done)
    })
    cost.frameMs = Math.round((performance.now() - after) * 1000) / 1000
    // What the engine does once the press is over: the reveal keeps re-measuring the page for two
    // more frames, so that a row which re-rendered under the remote still lands on the control the
    // viewer chose. Measured apart from the press, because it is frame time rather than input time.
    cost.settle = {
      rects: counts.rects,
      writes: counts.writes,
      forced: counts.forced,
    }
    await new Promise(function (done) {
      requestAnimationFrame(done)
    })
    cost.settleAfter = {
      rects: counts.rects,
      writes: counts.writes,
      forced: counts.forced,
    }
    return cost
  }

  async function walk(keys) {
    var steps = []
    for (var index = 0; index < keys.length; index += 1) steps.push(await press(keys[index]))
    return steps
  }

  /** How many posters the grid puts on one line, read from where they ended up. */
  function columns() {
    var top = null
    var count = 0
    for (var index = 0; index < gridCards.length; index += 1) {
      var box = gridCards[index].getBoundingClientRect()
      if (top === null) top = box.top
      if (Math.abs(box.top - top) > 4) break
      count += 1
    }
    return count
  }

  /** The worst and average of a walk's presses: what one press cost, on the page being measured. */
  function summarise(steps) {
    var ms = steps.map(function (step) {
      return step.ms
    })
    return {
      presses: steps.length,
      msAvg: Math.round((ms.reduce(function (sum, value) { return sum + value }, 0) / Math.max(1, ms.length)) * 1000) / 1000,
      msMax: Math.max.apply(null, ms.concat([0])),
      frameMsMax: Math.max.apply(null, steps.map(function (step) { return step.frameMs }).concat([0])),
      queries: Math.max.apply(null, steps.map(function (step) { return step.queries }).concat([0])),
      nodes: Math.max.apply(null, steps.map(function (step) { return step.nodes }).concat([0])),
      rects: Math.max.apply(null, steps.map(function (step) { return step.rects }).concat([0])),
      styles: Math.max.apply(null, steps.map(function (step) { return step.styles }).concat([0])),
      writes: Math.max.apply(null, steps.map(function (step) { return step.writes }).concat([0])),
      forced: Math.max.apply(null, steps.map(function (step) { return step.forced }).concat([0])),
      /** Geometry the reveal re-measures between the press and the frame after it. */
      settleRects: Math.max.apply(null, steps.map(function (step) { return step.settle.rects - step.rects }).concat([0])),
      settleWrites: Math.max.apply(null, steps.map(function (step) { return step.settle.writes - step.writes }).concat([0])),
      settleForced: Math.max.apply(null, steps.map(function (step) { return step.settle.forced - step.forced }).concat([0])),
      /** And between that frame and the one after it. */
      lateRects: Math.max.apply(null, steps.map(function (step) { return step.settleAfter.rects - step.settle.rects }).concat([0])),
    }
  }

  ;(async function () {
    await nextFrame()

    // Finding the controls at all is the floor under every press: the engine asks the document for
    // its focusables and measures each one before it can answer where a press should go. The three
    // steps are timed apart - each repeated, because one of them is faster than the clock can
    // resolve - so the report says which of them the press is paying for.
    function repeat(times, work) {
      var start = performance.now()
      for (var run = 0; run < times; run += 1) work()
      return Math.round(((performance.now() - start) / times) * 1000) / 1000
    }
    var queried = document.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])")
    var queryMs = repeat(50, function () {
      document.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])")
    })
    var rectMs = repeat(20, function () {
      for (var index = 0; index < queried.length; index += 1) queried[index].getBoundingClientRect()
    })
    // The counts are taken from one call on its own: the repeated timing above would otherwise be
    // counted as part of the press's own work.
    var findMs = repeat(20, function () {
      remote.focusables()
    })
    reset()
    var found = remote.focusables()
    var find = {
      controls: found.length,
      ms: findMs,
      queryMs: queryMs,
      rectMs: rectMs,
      queries: counts.queries,
      nodes: counts.nodes,
      rects: counts.rects,
      styles: counts.styles,
    }
    // The focus ring is kept by a class of the engine's own, and unmarking the control the viewer
    // left means asking the document for every control wearing it. Timed on its own, with a control
    // marked, so a sweep that costs nothing is left alone rather than rewritten for its own sake.
    heroActions.firstElementChild.classList.add("dpad-focus")
    var sweep = {
      marked: document.querySelectorAll(".dpad-focus").length,
      ms: repeat(50, function () {
        document.querySelectorAll(".dpad-focus")
      }),
    }

    // The second document query a press makes: the bands that scroll on their own, asked for once
    // per focus change so that Back can put the viewer where they were. Timed beside the first, for
    // the same reason - a query that costs nothing is not worth restructuring the engine for.
    var lanes = {
      found: document.querySelectorAll(".scroller, .grid, .card-board, .episodes, .library-icons, .letter-row, .settings-menu").length,
      ms: repeat(50, function () {
        document.querySelectorAll(".scroller, .grid, .card-board, .episodes, .library-icons, .letter-row, .settings-menu")
      }),
    }

    // A sideways walk along a wide row: the press the viewer makes most, and the one that has to
    // scroll the row to keep the focused card on screen.
    remote.placeFocus(stripCards[0])
    await nextFrame()
    var stripAcross = await walk(["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight"])
    var stripBox = strip.getBoundingClientRect()
    var focusedBox = document.activeElement.getBoundingClientRect()
    var row = {
      landed: focused(),
      scrollLeft: Math.round(strip.scrollLeft),
      scrollWidth: Math.round(strip.scrollWidth),
      clientWidth: Math.round(strip.clientWidth),
      insideRow: focusedBox.left >= stripBox.left - 0.5 && focusedBox.right <= stripBox.right + 0.5,
      snapType: computedStyle.call(window, strip).scrollSnapType,
      cost: summarise(stripAcross),
    }

    // A held key: the same press with no frame in between, which is what a remote sends while a
    // direction is held down. Nothing may be dropped, and nothing may be applied twice.
    remote.placeFocus(stripCards[0])
    await nextFrame()
    reset()
    var burstStart = performance.now()
    for (var burst = 0; burst < 12; burst += 1) remote.moveFocus("ArrowRight")
    var held = {
      presses: 12,
      landed: focused(),
      scrollLeft: Math.round(strip.scrollLeft),
      ms: Math.round((performance.now() - burstStart) * 1000) / 1000,
      queries: counts.queries,
      nodes: counts.nodes,
      rects: counts.rects,
      styles: counts.styles,
      writes: counts.writes,
      forced: counts.forced,
    }
    await nextFrame()

    // Down the page and back up: the toolbar's controls, the grid under them, and the rows of it.
    var columnsPerRow = columns()
    remote.placeFocus(document.querySelector('[data-name="tool-a-to-z"]'))
    await nextFrame()
    var fromToolbar = await press("ArrowDown")
    var acrossRow = await walk(["ArrowRight", "ArrowRight"])
    var downRows = await walk(["ArrowDown", "ArrowDown"])
    var upRows = await walk(["ArrowUp", "ArrowUp"])
    var backToStart = await walk(["ArrowLeft", "ArrowLeft"])
    var upToToolbar = await press("ArrowUp")

    // A programmatic scroll inside a row the engine scrolls: a snap container is allowed to move
    // the offset it was given, and a row that moves after the press is a row that lands late.
    strip.scrollLeft = 0
    await nextFrame()
    strip.scrollLeft = 420
    var snapImmediate = Math.round(strip.scrollLeft)
    await nextFrame()
    var snapSettled = Math.round(strip.scrollLeft)

    // What the page costs before any press: how many controls it holds, and how big it is.
    document.getElementById("probe").textContent = JSON.stringify({
      viewport: { width: width, height: height },
      fold: Math.round(height / scale),
      gridCards: GRID_CARDS,
  stripCards: STRIP_CARDS,
      columns: columnsPerRow,
      elements: document.getElementsByTagName("*").length,
      find: find,
      sweep: sweep,
      lanes: lanes,
      row: row,
      held: held,
      fromToolbar: fromToolbar,
      acrossRow: acrossRow.map(function (step) { return step.landed }),
      acrossRowCost: summarise(acrossRow),
      downRows: downRows.map(function (step) { return step.landed }),
      upRows: upRows.map(function (step) { return step.landed }),
      backToStart: backToStart.map(function (step) { return step.landed }),
      upToToolbar: upToToolbar,
      snap: { immediate: snapImmediate, settled: snapSettled },
      pageTop: Math.round(main.scrollTop),
      pageLeft: Math.round(main.scrollLeft),
    })
  })()
})()
