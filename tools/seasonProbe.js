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

  var ART = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='135'%3E%3C/svg%3E"

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

  var episodes = document.getElementById("episode-strip")
  var seasons = document.getElementById("season-strip")
  for (var i = 0; i < 12; i += 1) episodes.appendChild(card("episode", i, "S2 E" + (i + 1)))
  for (var j = 0; j < 9; j += 1) seasons.appendChild(card("card season-card", j, "Season " + (j + 1)))

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
    remote.placeFocus(cards[0])
    await nextFrame()

    var right = []
    for (var out = 1; out < cards.length; out += 1) {
      var was = episodes.scrollLeft
      remote.moveFocus("ArrowRight")
      await nextFrame()
      right.push(look(episodes, document.activeElement, was))
    }
    var atEnd = look(episodes, document.activeElement, episodes.scrollLeft)

    var left = []
    for (var back = cards.length - 2; back >= 0; back -= 1) {
      var wasBack = episodes.scrollLeft
      remote.moveFocus("ArrowLeft")
      await nextFrame()
      left.push(look(episodes, document.activeElement, wasBack))
    }
    var atStart = look(episodes, document.activeElement, episodes.scrollLeft)

    // The season row above it is walked the same way, so both rows are measured doing the thing
    // the viewer complained about rather than one of them sitting at offset zero.
    var seasonCards = [].slice.call(seasons.querySelectorAll(".season-card"))
    remote.placeFocus(seasonCards[0])
    await nextFrame()
    for (var seasonStep = 1; seasonStep < seasonCards.length; seasonStep += 1) {
      remote.moveFocus("ArrowRight")
      await nextFrame()
    }

    var strip = episodes.getBoundingClientRect()
    var seasonStrip = seasons.getBoundingClientRect()
    var page = document.getElementById("main").getBoundingClientRect()
    var seasonFocused = seasons.querySelector(".season-card.dpad-focus")
    var seasonRect = seasonFocused ? seasonFocused.getBoundingClientRect() : null
    document.getElementById("probe").textContent = JSON.stringify({
      strip: {
        clientWidth: Math.round(episodes.clientWidth),
        scrollWidth: Math.round(episodes.scrollWidth),
        left: Math.round(strip.left),
        right: Math.round(strip.right),
      },
      page: { left: Math.round(page.left), right: Math.round(page.right) },
      atEnd: atEnd,
      atStart: atStart,
      right: right,
      left: left,
      railScrollLeft: rail ? Math.round(rail.scrollLeft) : 0,
      pageScrollLeft: Math.round(document.getElementById("main").scrollLeft),
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
