/**
 * The season row probe's own script.
 *
 * The same fit the app applies in index.html (a 1500-wide canvas scaled to the screen, with
 * `--app-height` as that screen's height in canvas units), twelve episode cards in the season
 * page's own strip, nine seasons in the strip above it, and then the app's own navigation engine
 * walking right along the episodes the way the remote does.
 *
 * It reports what a television cannot be asked politely: how wide the strip is, how far it has
 * scrolled, and whether the card the remote landed on is actually inside the strip's own box.
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

  function nextFrame() {
    return new Promise(function (done) {
      requestAnimationFrame(function () {
        requestAnimationFrame(done)
      })
    })
  }

  function stripState(strip, focused) {
    var box = strip.getBoundingClientRect()
    var rect = focused ? focused.getBoundingClientRect() : null
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
    }
  }

  ;(async function walk() {
    // Walk the row the way a remote does: to the far end, then all the way back. Each press is
    // given the couple of frames the engine reveals a card over before the row is measured.
    remote.placeFocus(cards[0])
    await nextFrame()
    for (var out = 1; out < cards.length; out += 1) remote.moveFocus("ArrowRight")
    await nextFrame()
    var atEnd = stripState(episodes, document.activeElement)

    for (var back = 0; back < cards.length - 1; back += 1) remote.moveFocus("ArrowLeft")
    await nextFrame()
    var atStart = stripState(episodes, document.activeElement)

    // The season row above it is walked the same way, so both rows are measured doing the thing
    // the viewer complained about rather than one of them sitting at offset zero.
    var seasonCards = [].slice.call(seasons.querySelectorAll(".season-card"))
    remote.placeFocus(seasonCards[0])
    await nextFrame()
    for (var seasonStep = 1; seasonStep < seasonCards.length; seasonStep += 1) remote.moveFocus("ArrowRight")
    await nextFrame()

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
