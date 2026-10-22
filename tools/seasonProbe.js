/**
 * The season row probe's own script.
 *
 * The same fit the app applies in index.html (a 1500-wide canvas scaled to the screen, with
 * `--app-height` as that screen's height in canvas units), twelve episode cards in the season
 * page's own strip, nine seasons in the strip above it, and then the app's own navigation engine
 * walking right along the episodes the way the remote does - and back again.
 *
 * It reports what a television cannot be asked politely: how wide the strip is, how far it has
 * scrolled, and whether the card the remote landed on is actually inside the strip's own box -
 * at every press of the walk, not only at its two ends, and with the focus ring the viewer has
 * to be able to see.
 */
;(function () {
  var width = window.innerWidth
  var height = window.innerHeight
  var scale = width / 1500
  var root = document.documentElement
  root.style.zoom = String(scale)
  root.style.setProperty("--app-scale", String(scale))
  root.style.setProperty("--app-height", Math.round(height / scale) + "px")

  var ART = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='203'%3E%3C/svg%3E"

  function card(className, index, label) {
    var episode = className === "episode"
    var node = document.createElement("a")
    node.className = className
    node.setAttribute("href", "#")
    node.setAttribute("data-card", String(index))
    var art = document.createElement("span")
    art.className = episode ? "episode-art" : "card-art"
    var img = document.createElement("img")
    img.setAttribute("alt", "")
    img.setAttribute("src", ART)
    art.appendChild(img)
    var copy = document.createElement("span")
    copy.className = episode ? "episode-copy" : "card-copy"
    var title = document.createElement("span")
    title.className = episode ? "episode-title" : "card-title"
    title.textContent = label
    copy.appendChild(title)
    node.appendChild(art)
    node.appendChild(copy)
    return node
  }

  /**
   * A season tab: the app's own `.season-tab`, one per season of the show - the season's name as a
   * line of text, with the season being browsed carrying the violet rule under it and the tab the
   * remote rests on carrying the ring. The tabs are what the remote walks to change season, and the
   * strip scrolls under it when the focused tab reaches the edge.
   */
  function seasonTab(index) {
    var node = document.createElement("a")
    node.className = index === 1 ? "season-tab on" : "season-tab"
    node.setAttribute("href", "#")
    node.setAttribute("data-card", String(index))
    node.textContent = "Season " + (index + 1)
    return node
  }

  var episodes = document.getElementById("episode-strip")
  var seasons = document.getElementById("season-strip")
  for (var i = 0; i < 12; i += 1) episodes.appendChild(card("episode", i, "S2 E" + (i + 1)))
  for (var j = 0; j < 9; j += 1) seasons.appendChild(seasonTab(j))

  /*
   * The worst case the banner has to hold: an episode whose name runs long, and a show with more
   * genres and studios than one row of fact links can carry. Measured separately from the page as
   * it usually opens, because what it checks is different - the copy may not be clipped by the
   * banner, and the row may not be pushed off the bottom edge by a copy that is taller than the
   * share of the screen the banner takes.
   */
  var full = new URLSearchParams(window.location.search).get("full") === "1"
  if (full) {
    document.querySelector(".episode-spot h2").firstChild.textContent =
      "The Long Way Round And Back Again, And Then The Road Home After That"
    var links = document.querySelector(".meta-links")
    for (var g = 0; g < 6; g += 1) {
      var extra = document.createElement("a")
      extra.setAttribute("href", "#")
      extra.textContent = "Genre " + (g + 1)
      links.appendChild(extra)
    }
  }

  var remote = window.mirufinRemote
  var cards = [].slice.call(episodes.querySelectorAll(".episode"))
  var rail = document.querySelector(".side-nav")

  function nextFrame() {
    return new Promise(function (done) {
      requestAnimationFrame(function () {
        requestAnimationFrame(done)
      })
    })
  }

  /**
   * Where the remote's card sits in the row, and whether the row is showing it - the card whole,
   * and with the ring a focused still draws 3 units outside itself.
   *
   * `was` is the strip's offset before the press that brought focus here, which is what says
   * whether the row had to move for this card at all.
   */
  function look(strip, focused, was) {
    var box = strip.getBoundingClientRect()
    var rect = focused ? focused.getBoundingClientRect() : null
    var art = focused ? focused.querySelector(".episode-art") : null
    var artRect = art ? art.getBoundingClientRect() : null
    var fit = strip.offsetWidth > 0 ? box.width / strip.offsetWidth : 1
    var ring = 6 * fit
    var before = rect ? rect.left + (strip.scrollLeft - was) * fit : 0
    return {
      clientWidth: Math.round(strip.clientWidth),
      scrollWidth: Math.round(strip.scrollWidth),
      scrollLeft: Math.round(strip.scrollLeft),
      left: Math.round(box.left),
      right: Math.round(box.right),
      index: focused ? Number(focused.getAttribute("data-card")) : -1,
      inRow: Boolean(focused && focused.closest(".episode-scroller")),
      cardLeft: rect ? Math.round(rect.left) : 0,
      cardRight: rect ? Math.round(rect.right) : 0,
      cardInside: Boolean(rect && rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5),
      ringInside: Boolean(artRect && artRect.left - ring >= box.left - 0.5 && artRect.right + ring <= box.right + 0.5),
      needed: Boolean(rect && was !== null && before < box.left - 0.5),
      artWidth: artRect ? Math.round(artRect.width / fit) : 0,
    }
  }

  ;(async function walk() {
    // Walk the row the way a remote does: to the far end, then all the way back. Each press is
    // given the couple of frames the engine reveals a card over before the row is measured, so
    // what is measured is what the viewer ends up looking at.
    var pageMain = document.getElementById("main")
    // The page as it opens, before the remote has touched it: the season selector above, the
    // banner, and the row directly under the banner - all in design units, so a panel size cannot
    // change what is being asserted.
    var zoom = width / 1500
    function design(px) {
      return Math.round((px / zoom) * 10) / 10
    }
    var banner = document.querySelector(".browse-hero")
    var seasonBlock = document.querySelector(".season-tabs")
    var block = document.querySelector(".episode-block")
    var posterBox = document.querySelector(".season-poster").getBoundingClientRect()
    var spotBox = document.querySelector(".episode-spot").getBoundingClientRect()
    var actions = document.querySelector(".episode-actions")
    var pristineArt = cards[0].querySelector(".episode-art").getBoundingClientRect()
    var copyBox = document.querySelector(".hero-copy").getBoundingClientRect()
    var pristine = {
      fold: Math.round(height / zoom),
      banner: { top: design(banner.getBoundingClientRect().top), bottom: design(banner.getBoundingClientRect().bottom) },
      bannerHeight: design(banner.getBoundingClientRect().height),
      /** The season's own poster, at the head of the banner beside the copy. */
      poster: { top: design(posterBox.top), bottom: design(posterBox.bottom), width: design(posterBox.width), height: design(posterBox.height) },
      /** The copy the banner carries: it has to fit inside the banner rather than be clipped by it. */
      copy: { top: design(copyBox.top), bottom: design(copyBox.bottom), height: design(copyBox.height) },
      /** The order the page is read in, top to bottom: the banner's own copy - the show's title, its
         facts and its fact links - then the season selector, then the row it browses, then the episode
         the remote is on described under the row, and then the one band under both. */
      order: (function () {
        var marks = {
          title: ".hero-copy .hero-title",
          facts: ".hero-copy .kicker",
          links: ".hero-copy .meta-links",
          seasons: ".season-tabs",
          row: ".episode-scroller",
          episode: ".episode-spot h2",
          episodeFacts: ".episode-spot .kicker",
          chips: ".episode-spot .chips",
          overview: ".episode-spot .overview",
          actions: ".episode-actions",
        }
        var tops = {}
        for (var key in marks) {
          var node = document.querySelector(marks[key])
          tops[key] = node ? design(node.getBoundingClientRect().top) : -1
        }
        return tops
      })(),
      /** The band under the episode's details: every control on it, where each one sits and how tall
         it is. A season page carries one row of them - the episode's own watched state and the title's
         own actions - so every control shares one top line and one height, whatever each one does. */
      actionsRow: (function () {
        var band = document.querySelector(".episode-actions")
        var controls = [].slice.call(band.querySelectorAll(".btn"))
        return {
          count: controls.length,
          tops: controls.map(function (control) {
            return design(control.getBoundingClientRect().top)
          }),
          heights: controls.map(function (control) {
            return design(control.getBoundingClientRect().height)
          }),
          width: design(band.getBoundingClientRect().width),
          wraps: band.getBoundingClientRect().height > (controls[0] ? controls[0].getBoundingClientRect().height * 2 : 0),
        }
      })(),
      /** The episode the remote is on, described under the row that selects it. */
      spot: { top: design(spotBox.top), bottom: design(spotBox.bottom) },
      season: { top: design(seasonBlock.getBoundingClientRect().top), bottom: design(seasonBlock.getBoundingClientRect().bottom) },
      /** What the season selector's own box is made of, so a strip that grows can be explained. */
      seasonBox: (function () {
        var first = seasons.querySelector(".season-tab, .season-card")
        var box = first.getBoundingClientRect()
        var style = getComputedStyle(seasonBlock)
        return {
          height: design(seasonBlock.getBoundingClientRect().height),
          tab: { width: design(box.width), height: design(box.height) },
          padding: style.padding,
          gap: style.gap,
          font: getComputedStyle(first).fontSize + "/" + getComputedStyle(first).lineHeight,
          wrap: style.flexWrap,
        }
      })(),
      block: { top: design(block.getBoundingClientRect().top) },
      row: { top: design(episodes.getBoundingClientRect().top), bottom: design(episodes.getBoundingClientRect().bottom) },
      art: { top: design(pristineArt.top), bottom: design(pristineArt.bottom), width: design(pristineArt.width), height: design(pristineArt.height) },
      actions: { top: design(actions.getBoundingClientRect().top) },
      /* The one content boundary: the season's poster in the banner, the episode described under the
         row, the season selector's first tab, the row's first still and the actions under the row all
         begin on it. The banner's own copy sits to the right of the poster, as a title's page draws
         its copy beside its poster. */
      edges: {
        poster: design(posterBox.left),
        copy: design(document.querySelector(".hero-copy .eyebrow").getBoundingClientRect().left),
        spot: design(document.querySelector(".episode-spot h2").getBoundingClientRect().left),
        season: design(seasons.querySelector(".season-tab").getBoundingClientRect().left),
        row: design(cards[0].getBoundingClientRect().left),
        actions: design(actions.firstElementChild.getBoundingClientRect().left),
      },
    }
    var pageTopBefore = pageMain.scrollTop
    remote.placeFocus(cards[0])
    await nextFrame()
    var pageTopAtStart = pageMain.scrollTop

    var right = []
    for (var out = 1; out < cards.length; out += 1) {
      var was = episodes.scrollLeft
      remote.moveFocus("ArrowRight")
      await nextFrame()
      right.push(look(episodes, document.activeElement, was))
    }
    var atEnd = look(episodes, document.activeElement, episodes.scrollLeft)
    var pageTopAtEnd = pageMain.scrollTop

    var left = []
    for (var back = cards.length - 2; back >= 0; back -= 1) {
      var wasBack = episodes.scrollLeft
      remote.moveFocus("ArrowLeft")
      await nextFrame()
      left.push(look(episodes, document.activeElement, wasBack))
    }
    var atStart = look(episodes, document.activeElement, episodes.scrollLeft)
    var pageTopBack = pageMain.scrollTop

    // The season selector above it is walked the same way, so both strips are measured doing the
    // thing the viewer complained about rather than one of them sitting at offset zero.
    var seasonCards = [].slice.call(seasons.querySelectorAll(".season-tab"))
    remote.placeFocus(seasonCards[0])
    await nextFrame()
    for (var seasonStep = 1; seasonStep < seasonCards.length; seasonStep += 1) {
      remote.moveFocus("ArrowRight")
      await nextFrame()
    }

    var strip = episodes.getBoundingClientRect()
    var seasonStrip = seasons.getBoundingClientRect()
    var page = document.getElementById("main").getBoundingClientRect()
    var seasonFocused = seasons.querySelector(".season-tab.dpad-focus")
    var seasonRect = seasonFocused ? seasonFocused.getBoundingClientRect() : null
    document.getElementById("probe").textContent = JSON.stringify({
      strip: {
        clientWidth: Math.round(episodes.clientWidth),
        scrollWidth: Math.round(episodes.scrollWidth),
        left: Math.round(strip.left),
        right: Math.round(strip.right),
      },
      page: { left: Math.round(page.left), right: Math.round(page.right) },
      /* The page's own shape, measured before the remote touched it: the season selector across
         the top, the cinematic banner under it, and the row of stills directly under the banner. */
      pristine: pristine,
      atEnd: atEnd,
      atStart: atStart,
      right: right,
      left: left,
      railScrollLeft: rail ? Math.round(rail.scrollLeft) : 0,
      pageScrollLeft: Math.round(document.getElementById("main").scrollLeft),
      /* The row must not be a snap container: a still carries no `scroll-snap-align`, so an
         engine asked to snap here is being asked something it can never satisfy. */
      snapType: getComputedStyle(episodes).scrollSnapType,
      /* Where the page column was while the remote walked the row. Walking a row sideways must
         not move the page up or down: the row is the only thing that may move. */
      pageScrollTop: {
        before: Math.round(pageTopBefore),
        atStart: Math.round(pageTopAtStart),
        atEnd: Math.round(pageTopAtEnd),
        back: Math.round(pageTopBack),
      },
      seasonStrip: {
        clientWidth: Math.round(seasons.clientWidth),
        scrollWidth: Math.round(seasons.scrollWidth),
        scrollLeft: Math.round(seasons.scrollLeft),
        left: Math.round(seasonStrip.left),
        right: Math.round(seasonStrip.right),
        cardIndex: seasonFocused ? Number(seasonFocused.getAttribute("data-card")) : -1,
        cardInside: Boolean(
          seasonRect && seasonRect.left >= seasonStrip.left - 0.5 && seasonRect.right <= seasonStrip.right + 0.5,
        ),
      },
    })
  })()
})()
