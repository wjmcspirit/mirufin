/**
 * The season page walk probe's own script: the page the viewer complained about, walked with the
 * app's own navigation engine. It reports where focus landed at every press - the page's own
 * groups, in the page's own order - so a skip can be seen rather than argued about.
 *
 * `?shape=season` draws the season page (its head, then the episode block, then the cast), and
 * `?shape=series` draws the series page's shape (the same head and episode block with the seasons
 * row between them, and the title's own actions in the band under the row).
 *
 * `tools/foldCheck.ts` drives this page in a headless browser and asserts what comes back.
 */
;(function () {
  var params = new URLSearchParams(window.location.search)
  var shape = params.get("shape") === "series" ? "series" : "season"
  var width = window.innerWidth
  var height = window.innerHeight
  var scale = width / 1500
  var root = document.documentElement
  root.style.zoom = String(scale)
  root.style.setProperty("--app-scale", String(scale))
  root.style.setProperty("--app-height", Math.round(height / scale) + "px")

  var ART = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='203'%3E%3C/svg%3E"

  function element(tag, className, name) {
    var node = document.createElement(tag)
    node.className = className
    node.setAttribute("data-name", name)
    if (tag === "a") node.setAttribute("href", "#")
    return node
  }

  function art(className) {
    var box = document.createElement("span")
    box.className = className
    var img = document.createElement("img")
    img.setAttribute("alt", "")
    img.setAttribute("src", ART)
    box.appendChild(img)
    return box
  }

  function episodeCard(index) {
    var node = element("a", index === 1 ? "episode is-next" : "episode", "episode-" + (index + 1))
    node.appendChild(art("episode-art"))
    var copy = element("span", "episode-copy", "")
    var title = element("span", "episode-title", "")
    title.textContent = "S2 E" + (index + 1) + "  ·  Episode Name"
    copy.appendChild(title)
    var meta = element("span", "episode-meta", "")
    meta.textContent = "43m"
    copy.appendChild(meta)
    node.appendChild(copy)
    return node
  }

  function seasonCard(index) {
    var node = element("a", "card season-card", "season-" + (index + 1))
    node.appendChild(art("card-art"))
    var copy = element("span", "card-copy", "")
    var title = element("span", "card-title", "")
    title.textContent = "Season " + (index + 1)
    copy.appendChild(title)
    node.appendChild(copy)
    return node
  }

  function personCard(index) {
    var node = element("a", "person", "cast-" + (index + 1))
    node.appendChild(art("avatar"))
    var copy = element("span", "person-copy", "")
    copy.textContent = "Actor " + (index + 1)
    node.appendChild(copy)
    return node
  }

  function posterCard(index) {
    var node = element("a", "card poster", "similar-" + (index + 1))
    node.appendChild(art("card-art"))
    return node
  }

  function rowSection(id, heading) {
    var section = element("section", "row size-medium", id)
    var head = element("div", "row-head", "")
    var h2 = element("h2", "", "")
    h2.textContent = heading
    head.appendChild(h2)
    var strip = element("div", "scroller", id + "-strip")
    section.appendChild(head)
    section.appendChild(strip)
    return { section: section, strip: strip }
  }

  function fill(parent, count, make) {
    var made = []
    for (var index = 0; index < count; index += 1) {
      var node = make(index)
      parent.appendChild(node)
      made.push(node)
    }
    return made
  }

  // ---------------------------------------------------------------- the page
  var main = document.getElementById("main")
  var detail = element("div", "detail season-page browse-page", "detail")
  var hero = element("header", "detail-hero stage-copy", "hero")
  var layout = element("div", "detail-layout", "")
  layout.appendChild(element("div", "poster-lg", "poster"))
  var copy = element("div", "detail-copy", "hero-copy")
  copy.appendChild(element("p", "eyebrow", "hero-eyebrow"))
  var logo = element("h1", "logo-title", "")
  logo.textContent = "Sheriff Country"
  copy.appendChild(logo)
  var line = element("p", "season-line", "")
  var lineText = element("span", "season-line-text", "")
  lineText.textContent = "Season 2  ·  3 of 10 watched"
  line.appendChild(lineText)
  copy.appendChild(line)
  copy.appendChild(element("p", "kicker", "hero-facts"))
  var overview = element("p", "overview clamp", "")
  overview.textContent = "A synopsis of the season, two lines of it."
  copy.appendChild(overview)
  // The season's own fact links, where every other page keeps them: in the head.
  var facts = element("p", "meta-links genre-pills", "hero-links")
  var pills = [element("a", "", "genre-drama"), element("a", "", "genre-crime")]
  pills[0].textContent = "Drama"
  pills[1].textContent = "Crime"
  for (var p = 0; p < pills.length; p += 1) facts.appendChild(pills[p])
  copy.appendChild(facts)
  layout.appendChild(copy)
  hero.appendChild(layout)
  detail.appendChild(hero)

  var body = element("div", "detail-body", "body")
  if (shape === "series") {
    var seasons = rowSection("season-block", "Seasons")
    seasons.section.className = "row size-medium season-block"
    fill(seasons.strip, 9, seasonCard)
    body.appendChild(seasons.section)
  }

  var block = element("section", "episode-block", "episode-block")
  var blockHead = element("div", "row-head", "")
  var blockH2 = element("h2", "", "")
  blockH2.textContent = "Season 2"
  blockHead.appendChild(blockH2)
  var spot = element("div", "episode-spot", "episode-spot")
  spot.appendChild(element("p", "eyebrow", "spot-eyebrow"))
  var spotH2 = element("h2", "", "")
  spotH2.textContent = "S2 E1  ·  Family Trust"
  spot.appendChild(spotH2)
  spot.appendChild(element("p", "kicker", "spot-facts"))
  var spotOverview = element("p", "overview clamp", "")
  spotOverview.textContent = "A synopsis of the sort a server actually sends: two lines of it at this width."
  spot.appendChild(spotOverview)
  var strip = element("div", "scroller episode-scroller", "episode-strip")
  var episodeCards = fill(strip, 12, episodeCard)
  // A season's own actions are empty - it is not a title that plays, is favorited or is marked
  // watched on its own - so the band is drawn with nothing in it, exactly as the page draws it.
  // A series is a title, and its band carries the controls the remote can reach from the row.
  var actions = element("div", "actions episode-actions", "episode-actions")
  var actionButtons = []
  if (shape === "series") {
    actionButtons.push(element("a", "btn btn-primary", "play"))
    actionButtons[0].textContent = "Play"
    actionButtons.push(element("a", "btn", "media-info"))
    actionButtons[1].textContent = "Media info"
    for (var b = 0; b < actionButtons.length; b += 1) actions.appendChild(actionButtons[b])
  }
  block.appendChild(blockHead)
  block.appendChild(spot)
  block.appendChild(strip)
  block.appendChild(actions)
  body.appendChild(block)

  var cast = rowSection("cast-row", "Cast")
  cast.section.className = "row size-medium people-row"
  var castCards = fill(cast.strip, 8, personCard)
  body.appendChild(cast.section)
  var similar = rowSection("similar-row", "If you liked Sheriff Country")
  fill(similar.strip, 8, posterCard)
  body.appendChild(similar.section)
  detail.appendChild(body)
  main.appendChild(detail)
  var remote = window.mirufinRemote

  function nextFrame() {
    return new Promise(function (done) {
      requestAnimationFrame(function () {
        requestAnimationFrame(done)
      })
    })
  }

  /** The group of the page a control belongs to, so a walk can say where focus went. */
  function groupOf(node) {
    if (!node || node === document.body) return "none"
    if (node.closest(".detail-hero")) return "hero"
    if (node.closest(".episode-scroller")) return "episodes"
    if (node.closest(".episode-actions")) return "actions"
    if (node.closest(".people-row")) return "cast"
    if (node.closest(".season-block")) return "seasons"
    if (node.closest(".side")) return "rail"
    return "other"
  }

  function where() {
    var node = document.activeElement
    return {
      name: node && node.getAttribute ? node.getAttribute("data-name") || node.className : "body",
      group: groupOf(node),
      inRow: Boolean(node && node.closest && node.closest(".episode-scroller")),
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

  function edgeOf(node) {
    return node ? design(node.getBoundingClientRect().left) : -1
  }

  // The page as it opens, before the remote has touched it: every row is at its own beginning,
  // so a row's first card is a measurement of the page's layout rather than of a scroll.
  var pristineArt = episodeCards[0].querySelector(".episode-art").getBoundingClientRect()
  var before = {
    edges: {
      hero: edgeOf(document.querySelector(".poster-lg")),
      heading: edgeOf(blockHead.querySelector("h2")),
      spot: edgeOf(spot.querySelector(".eyebrow")),
      row: edgeOf(episodeCards[0]),
      actions: edgeOf(actions.firstElementChild),
      castHeading: edgeOf(cast.section.querySelector("h2")),
      castCard: edgeOf(castCards[0]),
    },
    art: { width: design(pristineArt.width), height: design(pristineArt.height) },
  }

  ;(async function () {
    // The landing holds the rail while the page has nothing of its own; the viewer's own press
    // from there is the first thing walked.
    remote.placeFocus(document.querySelector(".side-nav .nav"))
    await nextFrame()
    var fromRail = await walk(["ArrowDown"])

    // Down from the head's own controls: the page's next step, never the cast.
    remote.placeFocus(pills[0])
    await nextFrame()
    var fromHero = await walk(["ArrowDown", "ArrowDown"])

    // Along the row, then down out of it and back up again.
    remote.placeFocus(episodeCards[0])
    await nextFrame()
    var across = await walk(["ArrowRight", "ArrowRight", "ArrowRight"])
    var rowDown = await walk(["ArrowDown", "ArrowDown"])
    var backUp = await walk(["ArrowUp", "ArrowUp", "ArrowUp"])

    // Up from the cast, and up from the row: both have to find the page's own step above.
    remote.placeFocus(castCards[3])
    await nextFrame()
    var castUp = await walk(["ArrowUp", "ArrowUp"])
    remote.placeFocus(episodeCards[2])
    await nextFrame()
    var rowUp = await walk(["ArrowUp"])

    // The page as the viewer leaves it after walking down it: the rail again, from below.
    remote.placeFocus(document.querySelector(".side-nav .nav"))
    await nextFrame()
    var railAgain = await walk(["ArrowDown"])

    var stripBox = strip.getBoundingClientRect()
    var firstArt = episodeCards[0].querySelector(".episode-art").getBoundingClientRect()
    document.getElementById("probe").textContent = JSON.stringify({
      shape: shape,
      fromRail: fromRail,
      fromHero: fromHero,
      across: across,
      rowDown: rowDown,
      backUp: backUp,
      castUp: castUp,
      rowUp: rowUp,
      railAgain: railAgain,
      page: { top: Math.round(main.scrollTop), left: Math.round(main.scrollLeft) },
      rowScrollLeft: design(strip.scrollLeft),
      art: { width: design(firstArt.width), height: design(firstArt.height) },
      strip: { left: design(stripBox.left), right: design(stripBox.right) },
      cardWidth: design(episodeCards[0].getBoundingClientRect().width),
      /* The one content boundary, measured before anything was walked - a row the remote has
         scrolled is not a row out of alignment. The head's artwork, the season heading, the
         episode the remote is on, the row's first still, the actions under it and the cast all
         begin on it. */
      edges: before.edges,
      rowArt: before.art,
    })
  })()
})()

