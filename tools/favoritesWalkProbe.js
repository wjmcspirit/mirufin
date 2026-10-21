/**
 * The Favorites categories probe's own script.
 *
 * It draws the page the app draws - the hero with its own stack of actions, the heading beside the
 * row of categories, and the poster board under both - from the app's own stylesheet, and then walks
 * it with the app's own navigation engine. What it reports is what a television cannot be asked
 * politely: where focus landed at every press of the walk, and where the category row, its tabs and
 * the first poster of the grid ended up on screen, in the design units the layout is drawn in.
 *
 * The presses are the ones the page is for. Down from the hero's last action enters the categories
 * rather than the grid. Right and Left walk the row one category at a time and stop at each end.
 * Down from a category - any of them, not only the last - selects the first poster at the left of
 * the first visible row, and Up from it comes back to the category the viewer left.
 *
 * `tools/foldCheck.ts` drives this page in a headless browser at 1080p, 1440p and 4K and asserts
 * what comes back.
 */
;(function () {
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

  function art(className) {
    var box = element("span", className, "")
    var img = document.createElement("img")
    img.setAttribute("alt", "")
    img.setAttribute("src", ART)
    box.appendChild(img)
    return box
  }

  // The hero's own actions, in the order the shared Hero draws them: the primary action first, then
  // the secondary ones. They are a stack - Down walks them and leaves the row at its end - which is
  // what makes the category row the next step down the page.
  var heroActions = document.getElementById("hero-actions")
  var actionButtons = ["Play", "Details", "Favorite", "Trailers"].map(function (label, index) {
    var button = element(index === 0 ? "a" : "button", index === 0 ? "btn btn-primary" : "btn icon-btn", label.toLowerCase())
    button.textContent = label
    if (index === 0) button.setAttribute("href", "#")
    heroActions.appendChild(button)
    return button
  })

  // The categories, exactly as the page draws them: All first, and the five kinds of favorite after
  // it, the selected one marked with `aria-pressed`.
  var CATEGORIES = ["All", "Movies", "TV Shows", "Episodes", "Collections", "People"]
  var row = document.getElementById("categories")
  var tabs = CATEGORIES.map(function (label, index) {
    var button = element("button", "", "category-" + label.toLowerCase().replace(/ /g, "-"))
    button.setAttribute("type", "button")
    button.setAttribute("aria-pressed", index === 0 ? "true" : "false")
    button.textContent = label
    row.appendChild(button)
    return button
  })

  // The poster board: four rows of six, the size the viewer has chosen.
  var board = document.getElementById("favorites-grid")
  var COLUMNS = 6
  var cards = []
  for (var index = 0; index < COLUMNS * 4; index += 1) {
    var card = element("a", "card poster", "poster-" + (index + 1))
    card.appendChild(art("card-art"))
    var copy = element("span", "card-copy", "")
    var title = element("span", "card-title", "")
    title.textContent = "Favorite " + (index + 1)
    copy.appendChild(title)
    card.appendChild(copy)
    board.appendChild(card)
    cards.push(card)
  }

  var remote = window.mirufinRemote
  var main = document.getElementById("main")

  function nextFrame() {
    return new Promise(function (done) {
      requestAnimationFrame(function () {
        requestAnimationFrame(done)
      })
    })
  }

  /** Where one press left the remote, named by the control's own `data-name`. */
  function where() {
    var node = document.activeElement
    return {
      name: node && node.getAttribute ? node.getAttribute("data-name") || node.className : "body",
      inRow: Boolean(node && node.closest && node.closest("#categories")),
      inGrid: Boolean(node && node.closest && node.closest("#favorites-grid")),
      inRail: Boolean(node && node.closest && node.closest(".side")),
    }
  }

  async function walk(keys) {
    var steps = []
    for (var index = 0; index < keys.length; index += 1) {
      remote.moveFocus(keys[index])
      await nextFrame()
      steps.push(where())
    }
    return steps
  }

  var zoom = width / 1500

  /** A measurement in design units, so a panel size cannot change what is being asserted. */
  function design(px) {
    return Math.round((px / zoom) * 10) / 10
  }

  function units(node) {
    var box = node.getBoundingClientRect()
    return {
      top: design(box.top),
      bottom: design(box.bottom),
      left: design(box.left),
      right: design(box.right),
      width: design(box.width),
      height: design(box.height),
    }
  }

  /** The strip's own inset, in design units: what a band gives back either side of the boundary. */
  var stripPad = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--strip-pad")) || 0

  ;(async function () {
    var page = units(main)
    var head = units(document.querySelector(".favorites-head"))
    var rowBox = units(row)
    var tabBoxes = tabs.map(units)
    var boardBox = units(board)
    var firstCard = units(cards[0])
    var firstArt = units(cards[0].querySelector(".card-art"))
    var lastCard = units(cards[COLUMNS - 1])
    var heroBox = units(document.querySelector(".library-hero"))

    // The page as it opens, before the remote has touched it: the geometry every press below is
    // answered from, and the one content boundary the hero's copy, the heading and the first poster
    // all begin on - the head's own controls sit at the right of it, as a library's tools do.
    var shape = {
      fold: Math.round(height / zoom),
      hero: heroBox,
      head: head,
      row: rowBox,
      tabs: tabBoxes,
      board: boardBox,
      firstCard: firstCard,
      firstArt: firstArt,
      lastCard: lastCard,
      page: page,
      edges: {
        copy: design(document.querySelector(".hero-copy .eyebrow").getBoundingClientRect().left),
        heading: design(document.querySelector(".favorites-head h1").getBoundingClientRect().left),
        poster: firstCard.left,
        row: rowBox.right,
        grid: design(board.getBoundingClientRect().right) - stripPad,
      },
      tabsOnOneLine: tabBoxes.every(function (box) {
        return Math.abs(box.top - tabBoxes[0].top) < 1
      }),
    }

    // Down from the hero's own last action: the page's next step, which is the categories.
    remote.placeFocus(actionButtons[actionButtons.length - 1])
    await nextFrame()
    var fromHero = await walk(["ArrowDown"])

    // Down from each category that is not the last one, then Up: the poster under it, and back to
    // the category the viewer left.
    var fromCategory = []
    var backToCategory = []
    for (var index = 1; index < tabs.length - 1; index += 1) {
      remote.placeFocus(tabs[index])
      await nextFrame()
      var down = await walk(["ArrowDown"])
      fromCategory.push({ tab: index, landed: down[0] })
      var up = await walk(["ArrowUp"])
      backToCategory.push({ tab: index, landed: up[0] })
    }

    // The whole row, one category at a time, and the presses past its end and back.
    remote.placeFocus(tabs[0])
    await nextFrame()
    var across = await walk(["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight"])
    var back = await walk(["ArrowLeft", "ArrowLeft"])

    document.getElementById("probe").textContent = JSON.stringify({
      shape: shape,
      fromHero: fromHero,
      fromCategory: fromCategory,
      backToCategory: backToCategory,
      across: across,
      back: back,
      pageTop: Math.round(main.scrollTop),
      pageLeft: Math.round(main.scrollLeft),
    })
  })()
})()
