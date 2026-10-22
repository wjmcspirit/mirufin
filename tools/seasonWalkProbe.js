/**
 * The season page walk probe's own script: the page the viewer complained about, walked with the
 * app's own navigation engine. It reports where focus landed at every press - the page's own
 * groups, in the page's own order - so a skip can be seen rather than argued about.
 *
 * `?shape=season` draws the season page (its head, then the episode block - the banner that names the
 * show with the season's poster in it and the episode the remote is on under its logo, the season
 * selector on its own row, the row of stills and the band under the row - then the cast), and
 * `?shape=series` draws the series page's shape (the same banner and the show's own actions plus the
 * seasons row under them).
 *
 * `tools/foldCheck.ts` drives this page in a headless browser and asserts what comes back.
 */
;(function () {
  var params = new URLSearchParams(window.location.search)
  var shape = params.get("shape") === "series" ? "series" : "season"
  /*
   * Which of the app's own poster sizes the season posters are drawn at: the show's page draws its
   * seasons at the viewer's Poster size setting, and all three of them have to leave the row on the
   * screen the page opens on - the largest most of all. Medium is what the app opens on.
   */
  var size = ["small", "medium", "large"].indexOf(params.get("size")) >= 0 ? params.get("size") : "medium"
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

  /** A season poster on the show's page: the season's artwork, its name, its length and its bar. */
  function seasonCard(index) {
    var node = element("a", index === 1 ? "card poster season-card on" : "card poster season-card", "season-" + (index + 1))
    node.appendChild(art("card-art"))
    var copy = element("span", "card-copy", "")
    var title = element("span", "card-title", "")
    title.textContent = "Season " + (index + 1)
    var sub = element("span", "card-sub", "")
    sub.textContent = "3 of 10 watched"
    var bar = element("span", "season-bar", "")
    var fillBar = element("span", "", "")
    fillBar.style.width = "30%"
    bar.appendChild(fillBar)
    copy.appendChild(title)
    copy.appendChild(sub)
    copy.appendChild(bar)
    node.appendChild(copy)
    return node
  }

  /** A season tab in the season selector: the season's name, the one being browsed underlined. */
  function seasonTab(index) {
    var node = element("a", index === 1 ? "season-tab on" : "season-tab", "season-" + (index + 1))
    node.textContent = "Season " + (index + 1)
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
  var detail = element("div", "detail browse-page", "detail")
  var body = element("div", "detail-body", "body")
  var seasonCards = []
  var seasonTabs = []
  if (shape === "series") {
    // The show's page: the seasons as posters, under the show's own banner and actions. There is
    // no episode row here - browsing a season is the season's own page - so what the walk from
    // this row finds below it is the cast.
    var seasons = element("section", "season-block", "season-block")
    var seasonHead = element("div", "row-head", "")
    var seasonTitle = element("h2", "", "")
    seasonTitle.textContent = "Seasons (9)"
    seasonHead.appendChild(seasonTitle)
    var seasonStrip = element("div", "scroller season-scroller size-" + size, "season-strip")
    seasons.appendChild(seasonHead)
    seasons.appendChild(seasonStrip)
    seasonCards = fill(seasonStrip, 9, seasonCard)
    body.appendChild(seasons)
  } else {
    // The season's page: the season selector, on its own row under the banner that describes the
    // episode the remote is on. It is inserted into the block below, between that banner and the row
    // it browses.
    seasonStrip = element("nav", "scroller season-tabs", "season-tabs")
    seasonTabs = fill(seasonStrip, 9, seasonTab)
  }

  // The episode block: the cinematic banner that names the show with the season's poster in it and the
  // episode the remote is on under its logo, the season selector on its own row, the row of stills, and
  // the band under the row.
  var block = element("section", "episode-block", "episode-block")
  var banner = element("header", "hero stage-copy browse-hero", "banner")
  var copy = element("div", "hero-copy", "hero-copy")
  // The banner's own copy, in the order the page draws it on the page that browses a season: the
  // show's logo first, so its top is level with the season poster's own top edge, then the line that
  // says which season is being browsed, then the show's own facts, then the episode the remote is on
  // with its own facts and its synopsis, and then the show's fact links.
  var title = element("div", "hero-title", "hero-title")
  var logo = element("h1", "", "")
  logo.textContent = "Sheriff Country"
  title.appendChild(logo)
  copy.appendChild(title)
  var eyebrow = element("p", "eyebrow", "hero-eyebrow")
  eyebrow.textContent = "Season 2  ·  3 of 10 watched"
  copy.appendChild(eyebrow)
  var factsLine = element("p", "kicker", "hero-facts")
  factsLine.textContent = "2019  ·  2 Seasons  ·  TV-14  ·  7.9"
  copy.appendChild(factsLine)
  // The episode the remote is on, described in the banner under the show's logo: its own name with the
  // row's flags, its facts - which lead with its number - and what it is about. This is the block the
  // focus walk changes, and the block the season selector and the row of stills have to fit under.
  var spot = element("div", "hero-episode-info", "hero-episode-info")
  var spotTitle = element("p", "hero-episode", "hero-episode")
  spotTitle.textContent = "Family Trust"
  var upNext = element("span", "episode-flag", "")
  upNext.textContent = "Up next"
  spotTitle.appendChild(upNext)
  spot.appendChild(spotTitle)
  var spotFacts = element("p", "kicker", "hero-episode-facts")
  spotFacts.textContent = "S2:E1  ·  October 16, 2026  ·  43m  ·  TV-14  ·  7.9"
  spot.appendChild(spotFacts)
  var overview = element("p", "overview clamp", "hero-episode-overview")
  overview.textContent = "A synopsis of the sort a server actually sends: two lines of it at this width."
  spot.appendChild(overview)
  copy.appendChild(spot)
  // The show's own fact links, where every other page keeps them: in the head, which here is the
  // banner. The episode the remote is on is described above them, under the show's logo, and the room
  // the copy gives back is what keeps that description, the selector and the row of stills on screen
  // together.
  var facts = element("p", "meta-links genre-pills", "hero-links")
  var pills = [element("a", "", "genre-drama"), element("a", "", "genre-crime")]
  pills[0].textContent = "Drama"
  pills[1].textContent = "Crime"
  for (var p = 0; p < pills.length; p += 1) facts.appendChild(pills[p])
  copy.appendChild(facts)
  // The season's own poster, at the head of the page that browses it: a child of the banner, so it
  // stands on the banner's bottom edge beside the copy, on the page's content boundary.
  var poster = null
  if (shape !== "series") {
    poster = element("span", "season-poster", "season-poster")
    poster.setAttribute("data-season", "S2")
    var posterImg = document.createElement("img")
    posterImg.setAttribute("alt", "")
    posterImg.setAttribute("src", ART)
    poster.appendChild(posterImg)
    banner.appendChild(poster)
  }
  banner.appendChild(copy)

  var strip = element("div", "scroller episode-scroller", "episode-strip")
  var episodeCards = fill(strip, 12, episodeCard)
  // The one band a season page carries, under the episode's details: the focused episode's watched
  // toggle first, because the band is under that episode and settling it is what the control is for,
  // then the title's own actions - the season's Play, the season's own watched toggle and Media
  // info. A series carries its own Play and watched controls and has no episode to mark, so its band
  // is the title's own. The buttons are the same shape the page draws, so the walk and the left edge
  // are measured against the real band rather than an empty one.
  var actions = element("div", "actions episode-actions", "episode-actions")
  var actionButtons = []
  if (shape !== "series") {
    var episodeWatched = element("button", "btn icon-btn", "episode-watched")
    episodeWatched.textContent = "Mark Watched"
    actionButtons.push(episodeWatched)
  }
  if (shape === "series") {
    actionButtons.push(element("a", "btn btn-primary", "play"))
    actionButtons[0].textContent = "Play"
  } else {
    var play = element("a", "btn btn-primary", "play")
    play.textContent = "Play"
    actionButtons.push(play)
  }
  var watched = element("button", "btn icon-btn", shape === "series" ? "show-watched" : "season-watched")
  watched.textContent = shape === "series" ? "Mark show watched" : "Mark season watched"
  actionButtons.push(watched)
  var media = element("button", "btn icon-btn", "media-info")
  media.textContent = "Media info"
  actionButtons.push(media)
  for (var b = 0; b < actionButtons.length; b += 1) actions.appendChild(actionButtons[b])
  if (shape === "series") {
    // The show's own head: the banner and the show's actions under it, then the seasons row the
    // page was built with.
    var head = element("section", "series-head", "series-head")
    head.appendChild(banner)
    head.appendChild(actions)
    body.insertBefore(head, body.firstChild)
  } else {
    // The season's own page: the banner (which carries the episode the remote is on in its copy), the
    // season selector on its own row, the row of stills, and the band under the row.
    block.appendChild(banner)
    block.appendChild(seasonStrip)
    block.appendChild(strip)
    block.appendChild(actions)
    body.appendChild(block)
  }

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
    // The season selector is its own row, between the banner and the row it browses, so it is asked
    // about before the banner is: a tab is the selector, not the hero. The band under the row is the
    // page's one actions row - the watched state of the episode the banner describes and the title's
    // own actions share it - so it is one group rather than two.
    if (node.closest(".season-tabs")) return "seasons"
    if (node.closest(".browse-hero")) return "hero"
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
  // so a row's first card is a measurement of the page's layout rather than of a scroll. The season's
  // poster in the banner, the season selector's first control, the row's first still, the band under
  // the row and the cast all have to begin on the application's one content boundary. The banner's own
  // copy - the show's logo, the season line, the show's facts, the episode the remote is on and the
  // show's fact links - sits to the right of the poster, as a title's page draws its copy beside its
  // poster, and the episode the banner describes sits in that copy rather than under the row.
  var pristineArt = episodeCards[0].querySelector(".episode-art").getBoundingClientRect()
  var before = {
    edges: {
      poster: shape === "series" ? -1 : edgeOf(poster),
      copy: edgeOf(eyebrow),
      title: edgeOf(title),
      spot: shape === "series" ? -1 : edgeOf(spotTitle),
      season: shape === "series" ? edgeOf(seasonCards[0]) : edgeOf(seasonTabs[0]),
      row: shape === "series" ? -1 : edgeOf(episodeCards[0]),
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

    // Down from the season selector on the season's page: the episode row is the next step under it,
    // because the selector sits between the episode the page describes and the row it browses. The
    // cast is never what this press reaches, so the row is not skipped on the way down the page.
    var fromTabs = []
    if (shape !== "series") {
      remote.placeFocus(seasonTabs[1])
      await nextFrame()
      fromTabs = await walk(["ArrowDown", "ArrowDown"])
    }

    // Down from the seasons row on the show's page: this page has no episode row, so the cast is
    // its next step - and the press must not land on the rail or on nothing.
    var fromSeasons = []
    if (shape === "series") {
      remote.placeFocus(seasonCards[1])
      await nextFrame()
      fromSeasons = await walk(["ArrowDown", "ArrowDown"])
    }

    // Down from the banner's own controls: the page's next step, never the cast.
    remote.placeFocus(pills[0])
    await nextFrame()
    var fromHero = await walk(["ArrowDown", "ArrowDown"])

    // Along the row, then down out of it and back up again. A show's page has no row to walk: the
    // stills belong to the season's page.
    var across = []
    var rowDown = []
    var backUp = []
    var rowUp = []
    var acrossScroll = 0
    if (shape !== "series") {
      remote.placeFocus(episodeCards[0])
      await nextFrame()
      across = await walk(["ArrowRight", "ArrowRight", "ArrowRight"])
      // Where the row had scrolled to by the time the remote had walked three stills along it: the
      // row is what follows the remote, so this is measured at the end of the walk across.
      acrossScroll = design(strip.scrollLeft)
      // Down out of the row: the band under it settles the episode the banner describes, so the press
      // reaches the episode's own watched state first, then the cast below the page's content.
      rowDown = await walk(["ArrowDown", "ArrowDown", "ArrowDown"])
      backUp = await walk(["ArrowUp", "ArrowUp", "ArrowUp"])
      remote.placeFocus(episodeCards[2])
      await nextFrame()
      rowUp = await walk(["ArrowUp"])
    }

    // Along the one band under the episode's details: the episode's own watched state first, then
    // the title's own actions, all on one row. A sideways press walks that row; a vertical one
    // leaves it for the cast. Both are measured, because the band being one row is the point.
    var bandAcross = []
    if (shape !== "series") {
      remote.placeFocus(document.querySelector(".episode-actions .btn"))
      await nextFrame()
      bandAcross = await walk(["ArrowRight", "ArrowRight"])
    }

    // Up from the cast: on a season's page it has to find the row above it, through the two action
    // rows, and on a show's page the seasons it was browsing from.
    remote.placeFocus(castCards[3])
    await nextFrame()
    var castUp = await walk(["ArrowUp", "ArrowUp", "ArrowUp"])

    // The page as the viewer leaves it after walking down it: the rail again, from below.
    remote.placeFocus(document.querySelector(".side-nav .nav"))
    await nextFrame()
    var railAgain = await walk(["ArrowDown"])

    var stripBox = strip.getBoundingClientRect()
    var firstArt = episodeCards[0].querySelector(".episode-art").getBoundingClientRect()
    // The show's own page: where the seasons row and its first poster sit, in design units, before
    // anything was walked. The row is this page's browse surface, so the poster has to be on screen
    // at 1080p rather than half of it below the fold.
    var seasonRow = null
    if (shape === "series") {
      var rowBox = seasonStrip.getBoundingClientRect()
      var cardBox = seasonCards[0].getBoundingClientRect()
      var cardArt = seasonCards[0].querySelector(".card-art").getBoundingClientRect()
      seasonRow = {
        fold: design(height),
        top: design(rowBox.top),
        bottom: design(rowBox.bottom),
        cardTop: design(cardBox.top),
        cardBottom: design(cardBox.bottom),
        cardWidth: design(cardBox.width),
        art: { width: design(cardArt.width), height: design(cardArt.height) },
        artBottom: design(cardArt.bottom),
      }
    }
    document.getElementById("probe").textContent = JSON.stringify({
      shape: shape,
      fromRail: fromRail,
      fromTabs: fromTabs,
      fromSeasons: fromSeasons,
      fromHero: fromHero,
      across: across,
      rowDown: rowDown,
      bandAcross: bandAcross,
      backUp: backUp,
      castUp: castUp,
      rowUp: rowUp,
      railAgain: railAgain,
      page: { top: Math.round(main.scrollTop), left: Math.round(main.scrollLeft) },
      rowScrollLeft: design(strip.scrollLeft),
      rowScrollAfterAcross: acrossScroll,
      art: { width: design(firstArt.width), height: design(firstArt.height) },
      strip: { left: design(stripBox.left), right: design(stripBox.right) },
      cardWidth: design(episodeCards[0].getBoundingClientRect().width),
      /* The one content boundary, measured before anything was walked - a row the remote has
         scrolled is not a row out of alignment. The head's artwork, the season heading, the
         episode the remote is on, the row's first still, the actions under it and the cast all
         begin on it. */
      edges: before.edges,
      rowArt: before.art,
      seasonRow: seasonRow,
    })
  })()
})()

