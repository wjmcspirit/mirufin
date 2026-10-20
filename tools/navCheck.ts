/**
 * A focused check of the one thing this build had to get right for the remote: a press of
 * Back puts the viewer back on the item they left, in the row they left it in, at the offset
 * they left it at - never on Home, and never on the first item a page happened to render.
 *
 * It runs the real `remote.ts` against a small stand-in for the DOM: elements with classes,
 * attributes, rects and scroll offsets, a clock the check drives by hand, and the click
 * capture the remote's Enter arrives on. The routing around it - which route the router says
 * the viewer is on, and whether a navigation was a Back - belongs to React Router, so it is
 * fed in here exactly the way `RemoteNav` feeds it in.
 *
 * Run it with `npm run navcheck`.
 */
import { readFileSync } from "node:fs"
import {
  clearSeats,
  focusables,
  moveFocus,
  noteRoute,
  ownBack,
  placeFocus as placeFocusOn,
  resetFocusState,
  restoreSeat,
  takeBack,
  trackSeats,
} from "../src/lib/remote"
import { episodePlayHref } from "../src/lib/seasons"

let failures = 0

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }
  failures += 1
  console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`)
}

/** The real `placeFocus`, with the check's stand-in element standing in for a DOM one. */
function placeFocus(node: El) {
  placeFocusOn(node as unknown as HTMLElement)
}

/** A name for an element, so a failure says which one focus actually landed on. */
function label(node: El | null) {
  if (!node) return "nothing"
  const href = node.getAttribute("href")
  return `${node.tagName.toLowerCase()}.${node.className || "-"}${href ? `[${href}]` : ""}`
}

// ---------------------------------------------------------------------------
// The stand-in for the DOM
// ---------------------------------------------------------------------------

interface Rect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

const ZERO: Rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }

let clock = 0
let nextTimer = 0
let nextRaf = 0
const timers = new Map<number, { at: number; fn: () => void }>()
const rafs = new Map<number, (at: number) => void>()
const listeners = new Map<string, Set<(event: unknown) => void>>()
/** What the check has activated on purpose, so a restoration cannot activate anything. */
const activated: El[] = []
/** Observers currently watching the tree; the check fires them by hand. */
const watchers = new Set<Watcher>()

let active: El | null = null
let bodyNode: El | null = null

class El {
  tagName: string
  className: string
  attrs: Record<string, string> = {}
  parent: El | null = null
  children: El[] = []
  text = ""
  hidden = false
  connected = true
  scrollTop = 0
  scrollLeft = 0
  scrollHeight = 0
  clientHeight = 0
  scrollWidth = 0
  clientWidth = 0
  rect: Rect = ZERO

  constructor(tag: string, classes = "") {
    this.tagName = tag.toUpperCase()
    this.className = classes
  }

  get classes() {
    return this.className.split(/\s+/).filter(Boolean)
  }

  get classList() {
    return {
      contains: (name: string) => this.classes.includes(name),
      add: (name: string) => {
        if (!this.classes.includes(name)) this.className = `${this.className} ${name}`.trim()
      },
      remove: (name: string) => {
        this.className = this.classes.filter((entry) => entry !== name).join(" ")
      },
    }
  }

  get isConnected() {
    return this.connected
  }

  get textContent() {
    return this.text
  }

  get parentElement() {
    return this.parent
  }

  /** What the browser reports for `offsetLeft`: measured from the offsetParent's padding edge. */
  offsetLeftOverride: number | null = null

  get offsetLeft() {
    return this.offsetLeftOverride ?? this.rect.left
  }

  get offsetWidth() {
    return this.rect.width
  }

  add(...nodes: El[]) {
    for (const node of nodes) {
      node.parent = this
      this.children.push(node)
    }
    return this
  }

  attr(name: string, value: string) {
    this.attrs[name] = value
    return this
  }

  getAttribute(name: string) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }

  setAttribute(name: string, value: string) {
    this.attrs[name] = value
  }

  getBoundingClientRect() {
    return this.rect
  }

  /** Lay the element out, so the directional moves and the reveal have geometry to read. */
  place(top: number, left: number, width: number, height: number) {
    this.rect = { top, left, right: left + width, bottom: top + height, width, height }
    return this
  }

  focus() {
    active = this
  }

  blur() {
    if (active === this) active = null
  }

  scrollTo(options: { left?: number; top?: number } | number, y?: number) {
    if (typeof options === "number") {
      this.scrollLeft = options
      this.scrollTop = y ?? 0
      return
    }
    if (typeof options.left === "number") this.scrollLeft = options.left
    if (typeof options.top === "number") this.scrollTop = options.top
  }

  closest(selector: string) {
    let node: El | null = this
    while (node) {
      if (matches(node, selector)) return node
      node = node.parent
    }
    return null
  }

  contains(other: El | null) {
    let node = other ? other.parent : null
    while (node) {
      if (node === this) return true
      node = node.parent
    }
    return false
  }

  querySelectorAll(selector: string) {
    const found: El[] = []
    visit(this, (node) => {
      if (matches(node, selector)) found.push(node)
    })
    return found
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null
  }
}

function visit(root: El, each: (node: El) => void) {
  for (const child of root.children) {
    each(child)
    visit(child, each)
  }
}

/** Enough of a CSS matcher for the selectors `remote.ts` uses: tags, classes, attributes. */
function matches(node: El, selector: string) {
  return selector.split(",").some((part) => matchesOne(node, part.trim()))
}

const TOKEN = /^(?:\.([\w-]+)|\[([\w-]+)(?:[~|^$*]?=("[^"]*"|'[^']*'|[^\]]*))?\]|:not\(\[([\w-]+)\]\)|:not\(\.([\w-]+)\))/

function matchesOne(node: El, selector: string) {
  let rest = selector
  const tag = /^[a-zA-Z][\w-]*/.exec(rest)
  if (tag) {
    if (node.tagName.toLowerCase() !== tag[0].toLowerCase()) return false
    rest = rest.slice(tag[0].length)
  }
  while (rest.length > 0) {
    const found = TOKEN.exec(rest)
    if (!found) return false
    const [, cls, attr, value, notAttr, notClass] = found
    if (cls && !node.classes.includes(cls)) return false
    if (attr) {
      const got = node.getAttribute(attr)
      if (got === null) return false
      if (value !== undefined && got !== value.replace(/^["']|["']$/g, "")) return false
    }
    if (notAttr && node.getAttribute(notAttr) !== null) return false
    if (notClass && node.classes.includes(notClass)) return false
    rest = rest.slice(found[0].length)
  }
  return true
}

// ---------------------------------------------------------------------------
// Wiring the stand-in into the globals `remote.ts` reaches for
// ---------------------------------------------------------------------------

const root = new El("html")
const doc = {
  documentElement: root,
  get body() {
    return bodyNode as El
  },
  get activeElement() {
    return (active || bodyNode) as El
  },
  querySelector: (selector: string) => root.querySelector(selector),
  querySelectorAll: (selector: string) => root.querySelectorAll(selector),
  defaultView: null as unknown,
}

const win = {
  addEventListener(type: string, fn: (event: unknown) => void) {
    const set = listeners.get(type) || new Set()
    set.add(fn)
    listeners.set(type, set)
  },
  removeEventListener(type: string, fn: (event: unknown) => void) {
    listeners.get(type)?.delete(fn)
  },
  setTimeout(fn: () => void, ms = 0) {
    nextTimer += 1
    timers.set(nextTimer, { at: clock + ms, fn })
    return nextTimer
  },
  clearTimeout(id: number) {
    timers.delete(id)
  },
  requestAnimationFrame(fn: (at: number) => void) {
    nextRaf += 1
    rafs.set(nextRaf, fn)
    return nextRaf
  },
  cancelAnimationFrame(id: number) {
    rafs.delete(id)
  },
  scrollTo(_x: number, y: number) {
    win.scrollY = y
  },
  scrollY: 0,
  innerWidth: 1920,
  innerHeight: 1080,
}

class Watcher {
  private callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
  }
  observe() {
    watchers.add(this)
  }
  disconnect() {
    watchers.delete(this)
  }
  fire() {
    this.callback()
  }
}

function installDom() {
  const globals = globalThis as unknown as Record<string, unknown>
  globals.HTMLElement = El
  globals.Element = El
  globals.Node = El
  globals.document = doc
  globals.window = win
  globals.performance = { now: () => clock }
  globals.MutationObserver = Watcher
  globals.getComputedStyle = (node: El) => ({ visibility: node.hidden ? "hidden" : "visible" })
  // `reveal` reaches for the frame callback on its own, the way a browser exposes it.
  globals.requestAnimationFrame = win.requestAnimationFrame
  globals.cancelAnimationFrame = win.cancelAnimationFrame
}

// ---------------------------------------------------------------------------
// Pages, and the clock the check drives by hand
// ---------------------------------------------------------------------------

/** Advance the clock in small steps, so a retry loop is exercised the way it runs for real. */
function run(ms: number) {
  const end = clock + ms
  while (clock < end) {
    clock = Math.min(end, clock + 20)
    drain()
  }
}

function drain() {
  for (let pass = 0; pass < 500; pass += 1) {
    const due = [...timers.entries()].filter(([, timer]) => timer.at <= clock)
    const frames = [...rafs.entries()]
    if (due.length === 0 && frames.length === 0) return
    for (const [id, timer] of due) {
      timers.delete(id)
      timer.fn()
    }
    for (const [id, frame] of frames) {
      rafs.delete(id)
      frame(clock)
    }
  }
}

/** A fresh screen: the rail on the left, an empty scrolling column on the right. */
function shell() {
  root.children = []
  bodyNode = new El("body")
  active = null
  const side = new El("header", "side")
  const nav = new El("nav", "side-nav")
  const rail = new El("a", "nav active").attr("href", "/")
  rail.text = "Home"
  rail.place(60, 24, 48, 48)
  nav.add(rail)
  side.add(nav)
  const main = new El("div", "main")
  main.place(0, 0, 1920, 1080)
  main.clientHeight = 1080
  main.scrollHeight = 6000
  const frame = new El("div", "shell")
  frame.add(side, main)
  bodyNode.add(frame)
  root.add(bodyNode)
  return { main, side, rail }
}

/**
 * Scroll the page column by `amount`, moving every rect inside it up with it - which is what a
 * browser reports for a page that has been scrolled, and the state a check has to model before it
 * can ask where the remote enters a page that is no longer at its own top.
 */
function scrollPage(main: El, amount: number) {
  main.scrollTop = amount
  visit(main, (node) => {
    node.rect = { ...node.rect, top: node.rect.top - amount, bottom: node.rect.bottom - amount }
  })
}

/** A home row: a heading, a sideways strip of posters. */
function row(main: El, title: string, hrefs: string[]) {
  const section = new El("section", "row size-medium")
  const head = new El("div", "row-head")
  const h2 = new El("h2")
  h2.text = title
  head.add(h2)
  const scroller = new El("div", "scroller")
  scroller.place(400, 0, 1600, 400)
  scroller.clientWidth = 1600
  scroller.scrollWidth = 4000
  const cards = hrefs.map((href, index) => {
    const card = new El("a", "card poster").attr("href", href)
    card.place(400, index * 200, 168, 252)
    scroller.add(card)
    return card
  })
  section.add(head, scroller)
  main.add(section)
  return { section, scroller, cards }
}

/** Home's hero: its own "Details" link goes to the same title a row card does. */
function hero(main: El, href: string) {
  const section = new El("section", "hero stage-copy")
  const copy = new El("div", "hero-copy")
  const actions = new El("div", "actions")
  const details = new El("a", "btn").attr("href", href)
  details.text = "Details"
  details.place(120, 48, 140, 44)
  actions.add(details)
  copy.add(actions)
  section.add(copy)
  main.add(section)
  return { section, details }
}

/** The band under a title's portrait: playback actions. */
function detailHero(main: El) {
  const header = new El("header", "detail-hero stage-copy")
  const actions = new El("div", "actions detail-actions")
  const play = new El("a", "btn btn-primary").attr("href", "/play/MOVIE?resume=0")
  play.text = "Play"
  play.place(60, 48, 140, 44)
  actions.add(play)
  header.add(actions)
  main.add(header)
  return { header, play }
}

/** A library: one wrapping grid of posters. */
function grid(main: El, hrefs: string[], cols = 6) {
  const board = new El("div", "grid poster size-medium")
  const cards = hrefs.map((href, index) => {
    const card = new El("a", "card poster").attr("href", href)
    card.place(100 + Math.floor(index / cols) * 300, (index % cols) * 200, 168, 252)
    board.add(card)
    return card
  })
  main.add(board)
  return { board, cards }
}

/** A title's cast carousel: a row of people, with no heading to name it by. */
/** A row of people: a heading, and a sideways strip of cast or crew cards. */
function people(main: El, ids: string[], title = "Cast", top = 500) {
  const section = new El("section", "row size-medium people-row")
  const head = new El("div", "row-head")
  const h2 = new El("h2")
  h2.text = title
  head.add(h2)
  const scroller = new El("div", "scroller")
  scroller.place(top, 0, 1600, 300)
  scroller.clientWidth = 1600
  scroller.scrollWidth = 4000
  const links = ids.map((id, index) => {
    const link = new El("a", "person").attr("href", `/item/${id}`)
    link.place(top, index * 180, 150, 220)
    scroller.add(link)
    return link
  })
  section.add(head, scroller)
  main.add(section)
  return { section, scroller, links }
}

/** One group of search results, named by the heading above it. */
function searchGroup(main: El, title: string, hrefs: string[]) {
  const group = new El("section", "search-group search-results")
  const h2 = new El("h2")
  h2.text = title
  const hits = new El("div", "search-hits")
  const cards = hrefs.map((href, index) => {
    const card = new El("a", "card poster").attr("href", href)
    card.place(200, index * 200, 168, 252)
    hits.add(card)
    return card
  })
  group.add(h2, hits)
  main.add(group)
  return { group, hits, cards }
}

/** What the remote's Enter does to the focused control: a click on it, on the way in. */
function activate(node: El) {
  activated.push(node)
  const event = { type: "click", target: node, currentTarget: node, preventDefault() {}, stopPropagation() {} }
  for (const handler of [...(listeners.get("click") || [])]) handler(event)
}


// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

/**
 * A season browsing block: the heading, the details of the episode the remote is on, the row
 * of episode stills, and the actions under the row - the shape the season page renders.
 */
function seasonBlock(main: El) {
  const section = new El("section", "episode-block")
  const head = new El("div", "row-head")
  const h2 = new El("h2")
  h2.text = "Season 2"
  head.add(h2)
  const spot = new El("div", "episode-spot")
  spot.place(664, 400, 1000, 104)
  const scroller = new El("div", "scroller episode-scroller")
  scroller.place(780, 400, 1600, 268)
  scroller.clientWidth = 1600
  scroller.scrollWidth = 6000
  scroller.clientHeight = 268
  scroller.scrollHeight = 268
  // Each card carries the app's own destination for an episode in a season's row - OK on it plays
  // that episode - and the episode's id beside it, the way the page keeps it.
  const cards = ["EP1", "EP2", "EP3", "EP4"].map((id, index) => {
    const card = new El("a", "episode")
      .attr("href", episodePlayHref({ Id: id, Name: id, Type: "Episode" }))
      .attr("data-episode", id)
    card.place(780, 400 + index * 300, 280, 232)
    scroller.add(card)
    return card
  })
  const actions = new El("div", "actions episode-actions")
  actions.place(1060, 400, 700, 48)
  const play = new El("button", "btn icon-btn")
  play.text = "Play"
  play.place(1070, 400, 176, 48)
  const favorite = new El("button", "btn icon-btn")
  favorite.text = "Favorite"
  favorite.place(1070, 592, 148, 48)
  actions.add(play, favorite)
  section.add(head, spot, scroller, actions)
  main.add(section)
  return { section, scroller, cards, play, favorite }
}

/**
 * One season's episode row as the page lays it out: a strip of twelve stills, each 360 wide with
 * a 14 gap, inside a scroller with the app's own 32 of padding either side. The strip is 1336
 * wide, so four stills and part of the fifth are on screen and the rest are a sideways press away
 * - and the strip clips, exactly as `overflow-x: auto` does on the television.
 *
 * The cards are laid out in the strip's own content coordinates, and each one is told what the
 * browser would report as its `offsetLeft`: its position inside the strip, which is what the
 * reveal measures a card with. The strip's own `scrollTo` clamps the way a browser does, so a
 * check cannot pass on a row that scrolled past its last still.
 */
function episodeRow(main: El, count: number, withActions = true) {
  const PADDING = 32
  const CARD = 360
  const GAP = 14
  const HEIGHT = 275
  const section = new El("section", "episode-block")
  const head = new El("div", "row-head")
  const h2 = new El("h2")
  h2.text = "Season 2"
  head.add(h2)
  const spot = new El("div", "episode-spot")
  spot.place(300, 400, 1000, 104)
  const scroller = new El("div", "scroller episode-scroller")
  scroller.place(430, 400, 1336, HEIGHT)
  scroller.clientWidth = 1336
  scroller.clientHeight = HEIGHT
  scroller.scrollWidth = PADDING * 2 + count * CARD + (count - 1) * GAP
  scroller.scrollHeight = HEIGHT
  scroller.scrollTo = (options: { left?: number; top?: number } | number) => {
    const left = typeof options === "number" ? options : options.left ?? scroller.scrollLeft
    scroller.scrollLeft = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, left))
  }
  const cards = Array.from({ length: count }, (_, index) => {
    // The destination is the app's own for a card in a season's row: OK on it plays the episode
    // the remote was on rather than opening the episode's own page. The episode's id is kept on
    // the card the way the page keeps it.
    const id = `EP${index + 1}`
    const card = new El("a", index === 1 ? "episode is-next" : "episode")
      .attr("href", episodePlayHref({ Id: id, Name: `Episode ${index + 1}`, Type: "Episode" }))
      .attr("data-episode", id)
    card.place(430, 400 + PADDING + index * (CARD + GAP), CARD, HEIGHT)
    card.offsetLeftOverride = PADDING + index * (CARD + GAP)
    scroller.add(card)
    return card
  })
  const actions = new El("div", "actions episode-actions")
  actions.place(720, 400, 700, 48)
  const play = new El("button", "btn btn-primary")
  play.text = "Play"
  play.place(730, 440, 176, 48)
  if (withActions) actions.add(play)
  section.add(head, spot, scroller, actions)
  main.add(section)
  return { section, scroller, cards, play, actions }
}

/**
 * The season page's own shape, as the app renders it: a head whose controls are the season's fact
 * links, then the episode block - the season heading, the episode the remote is on, the row of
 * stills and the band under it, which for a season holds no controls at all - then the cast, and
 * then what the viewer might watch next.
 *
 * A season is not a title in its own right: there is no Play, no Favorite and no Mark watched on
 * it, so its action band is drawn with nothing in it. That is the shape the reported bug happened
 * in: with the fact links under the row instead of in the head, Down from the row reached a genre
 * label and Up from the cast reached a label rather than the row.
 */
function seasonPage(main: El) {
  const hero = new El("header", "detail-hero stage-copy")
  hero.place(60, 0, 1920, 420)
  const links = new El("p", "meta-links genre-pills")
  const pills = ["/library/L1?genre=Drama", "/library/L1?genre=Crime"].map((href, index) => {
    const pill = new El("a", "").attr("href", href)
    pill.text = index === 0 ? "Drama" : "Crime"
    pill.place(320 + index * 120, 50, 110, 40)
    links.add(pill)
    return pill
  })
  hero.add(links)
  main.add(hero)

  // The row and the band under it. A season's own band holds no controls, so it is drawn empty -
  // which is why the row's next step down the page is the cast.
  const block = episodeRow(main, 12, false)
  const cast = people(main, ["P1", "P2", "P3", "P4", "P5", "P6"], "Cast", 1200)
  const similar = row(main, "If you liked this", ["/item/S1", "/item/S2", "/item/S3"])
  similar.scroller.place(1500, 0, 1600, 300)
  similar.cards.forEach((card, index) => card.place(1500, index * 200, 168, 252))
  return { hero, links, pills, block, cast, similar }
}

/** The part of the row's own contents the strip is showing, in the coordinates it lays out in. */
function rowWindow(scroller: El) {
  const left = scroller.rect.left + scroller.scrollLeft
  return { left, right: left + scroller.clientWidth }
}

/** Is the whole of this still inside what the row is showing? */
function inWindow(scroller: El, card: El) {
  const window = rowWindow(scroller)
  return card.rect.left >= window.left - 0.5 && card.rect.right <= window.right + 0.5
}

/**
 * The hero and the first row: Down leaves the hero's own actions for the first card under it,
 * and Up comes back to those actions rather than to the rail or to nothing.
 */
function testHeroAndFirstRow() {
  clearSeats()
  resetFocusState()
  const { main } = shell()
  const spot = hero(main, "/item/MOVIE")
  const first = row(main, "Continue watching", ["/item/R1", "/item/R2", "/item/R3"])
  noteRoute("/")

  placeFocus(spot.details)
  moveFocus("ArrowDown")
  check("Down leaves the hero's actions for the first row", active === first.cards[0], label(active))

  moveFocus("ArrowRight")
  check("and the row walks sideways from there", active === first.cards[1], label(active))

  moveFocus("ArrowUp")
  check("Up comes back to the hero's actions", active === spot.details, label(active))
}

/** A Home row poster -> details -> Back, on the same poster. */
function testHomeRow() {
  clearSeats()
  // The hero offers a link to the same title a row card does: the old memory took the first
  // href it found in the document, which was the hero's.
  const home = () => {
    const { main } = shell()
    const spot = hero(main, "/item/MOVIE")
    const recent = row(main, "Recently added", ["/item/MOVIE", "/item/OTHER", "/item/THIRD"])
    return { main, recent, spot }
  }
  const first = home()
  noteRoute("/")
  placeFocus(first.recent.cards[0])
  first.main.scrollTop = 620
  first.recent.scroller.scrollLeft = 340
  activate(first.recent.cards[0])

  shell()
  noteRoute("/item/MOVIE")
  let landed = false
  restoreSeat("/item/MOVIE", true, () => {
    landed = true
  })
  check("a screen with nothing remembered lands itself", landed)

  const back = home()
  noteRoute("/")
  let fellBack = false
  const cancel = restoreSeat("/", true, () => {
    fellBack = true
  })
  run(200)
  const order = back.main.querySelectorAll("a[href]")
  check(
    "the check is set up the way the bug appeared: the hero's link to the same title comes first",
    back.spot.details.getAttribute("href") === back.recent.cards[0].getAttribute("href") &&
      order.indexOf(back.spot.details) < order.indexOf(back.recent.cards[0]),
  )
  check("Back returns to the poster in its own row, not the hero link to the same title", active === back.recent.cards[0], label(active))
  check("Back is not answered by the generic landing", !fellBack)
  check("the returned poster is the marked, focused control", back.recent.cards[0].classes.includes("dpad-focus"))
  check("Back restores the column offset", back.main.scrollTop === 620, String(back.main.scrollTop))
  check("Back restores the row's sideways offset", back.recent.scroller.scrollLeft === 340, String(back.recent.scroller.scrollLeft))
  check("the poster was not activated a second time", activated.filter((node) => node === back.recent.cards[0]).length === 0)
  moveFocus("ArrowRight")
  check("the next D-pad press moves from the restored poster", active === back.recent.cards[1], label(active))
  cancel()
}

/** A cast carousel -> the actor's profile -> Back, with another row linking to the same actor. */
function testActorCarousel() {
  clearSeats()
  const movie = () => {
    const { main } = shell()
    detailHero(main)
    const cast = people(main, ["ACTOR_A", "ACTOR_B", "ACTOR_C"])
    const similar = row(main, "More like this", ["/item/ACTOR_B", "/item/OTHER"])
    return { main, cast, similar }
  }
  const first = movie()
  noteRoute("/item/MOVIE")
  placeFocus(first.cast.links[1])
  first.main.scrollTop = 480
  first.cast.scroller.scrollLeft = 260
  activate(first.cast.links[1])

  shell()
  noteRoute("/item/ACTOR_B")
  let landed = false
  restoreSeat("/item/ACTOR_B", true, () => {
    landed = true
  })
  check("an actor's own page opens with its own landing", landed)

  const back = movie()
  noteRoute("/item/MOVIE")
  let fellBack = false
  const cancel = restoreSeat("/item/MOVIE", true, () => {
    fellBack = true
  })
  run(200)
  check(
    "the check is set up the way the bug appeared: another row links to the same actor",
    back.similar.cards[0].getAttribute("href") === back.cast.links[1].getAttribute("href"),
  )
  check("Back returns to the exact actor in the cast carousel", active === back.cast.links[1], label(active))
  check("Back does not land on the other row that links to the same actor", active !== back.similar.cards[0], label(active))
  check("Back restores the carousel's sideways offset", back.cast.scroller.scrollLeft === 260, String(back.cast.scroller.scrollLeft))
  check("Back restores the column offset", back.main.scrollTop === 480, String(back.main.scrollTop))
  check("Back is not answered by the generic landing", !fellBack)
  check("the actor was not opened a second time", activated.filter((node) => node === back.cast.links[1]).length === 0)
  moveFocus("ArrowLeft")
  check("the next D-pad press moves from the restored actor", active === back.cast.links[0], label(active))
  cancel()
}


/** Library poster -> details -> Back. */
function testLibraryGrid() {
  clearSeats()
  const ids = Array.from({ length: 12 }, (_, index) => `/item/T${String(index).padStart(2, "0")}`)
  const library = () => {
    const { main } = shell()
    const board = grid(main, ids)
    return { main, board }
  }
  const first = library()
  noteRoute("/library/1")
  placeFocus(first.board.cards[7])
  first.main.scrollTop = 1400
  activate(first.board.cards[7])

  shell()
  noteRoute("/item/T07")
  restoreSeat("/item/T07", true, () => {})

  const back = library()
  noteRoute("/library/1")
  let fellBack = false
  const cancel = restoreSeat("/library/1", true, () => {
    fellBack = true
  })
  run(200)
  check("Back returns to the same poster in the library grid", active === back.board.cards[7], label(active))
  check("Back restores the library's column offset", back.main.scrollTop === 1400, String(back.main.scrollTop))
  check("Back is not answered by the generic landing", !fellBack)
  cancel()
}

/** Search result -> details -> Back, query and all. */
function testSearchResult() {
  clearSeats()
  const search = () => {
    const { main } = shell()
    const movies = searchGroup(main, "Movies", ["/item/DUNE", "/item/ARRIVAL"])
    const shows = searchGroup(main, "TV shows", ["/item/SEVERANCE"])
    return { main, movies, shows }
  }
  const first = search()
  noteRoute("/search?q=dune")
  placeFocus(first.movies.cards[0])
  activate(first.movies.cards[0])

  shell()
  noteRoute("/item/DUNE")
  restoreSeat("/item/DUNE", true, () => {})

  const back = search()
  noteRoute("/search?q=dune")
  let fellBack = false
  const cancel = restoreSeat("/search?q=dune", true, () => {
    fellBack = true
  })
  run(200)
  check("Back returns to the same search result, under the query it was found with", active === back.movies.cards[0], label(active))
  check("Back is not answered by the generic landing", !fellBack)
  cancel()

  // Another query is another screen, and has nothing remembered of its own.
  const other = shell()
  searchGroup(other.main, "Movies", ["/item/ARRIVAL"])
  noteRoute("/search?q=arrival")
  let landed = false
  restoreSeat("/search?q=arrival", true, () => {
    landed = true
  })
  check("a different query has no seat of its own", landed)
}


/** Home -> title -> actor, then Back twice: one level at a time, each context restored. */
function testNestedBack() {
  clearSeats()
  const home = () => {
    const { main } = shell()
    const recent = row(main, "Recently added", ["/item/MOVIE", "/item/OTHER"])
    return { main, recent }
  }
  const movie = () => {
    const { main } = shell()
    const cast = people(main, ["ACTOR_A", "ACTOR_B"])
    return { main, cast }
  }
  const start = home()
  noteRoute("/")
  placeFocus(start.recent.cards[0])
  activate(start.recent.cards[0])

  const title = movie()
  noteRoute("/item/MOVIE")
  placeFocus(title.cast.links[1])
  activate(title.cast.links[1])

  shell()
  noteRoute("/item/ACTOR_B")
  restoreSeat("/item/ACTOR_B", true, () => {})

  const step1 = movie()
  noteRoute("/item/MOVIE")
  const cancel1 = restoreSeat("/item/MOVIE", true, () => {})
  run(100)
  check("the first Back unwinds one level, to the actor it was opened from", active === step1.cast.links[1], label(active))

  const step2 = home()
  noteRoute("/")
  const cancel2 = restoreSeat("/", true, () => {})
  run(100)
  check("the second Back unwinds to the poster, not to a hard-coded Home", active === step2.recent.cards[0], label(active))
  cancel1()
  cancel2()
}

/** A list that renders after the route has changed is waited for, not abandoned. */
function testDelayedList() {
  clearSeats()
  const bare = () => {
    const { main } = shell()
    return { main }
  }
  const first = bare()
  const recent = row(first.main, "Recently added", ["/item/MOVIE", "/item/OTHER"])
  noteRoute("/")
  placeFocus(recent.cards[0])
  activate(recent.cards[0])

  shell()
  noteRoute("/item/MOVIE")
  restoreSeat("/item/MOVIE", true, () => {})

  const back = bare()
  noteRoute("/")
  let fellBack = false
  const cancel = restoreSeat("/", true, () => {
    fellBack = true
  })
  run(400)
  check("a row that has not rendered yet is not given up on", !fellBack)
  const late = row(back.main, "Recently added", ["/item/MOVIE", "/item/OTHER"])
  run(200)
  check("the poster is focused once the row arrives", active === late.cards[0], label(active))
  cancel()
}

/** An item that is genuinely gone falls back to its row; a row that is gone too, to the page. */
function testMissingTarget() {
  // The row is still there, the poster is not: the row's own first card is the answer.
  clearSeats()
  const first = shell()
  const recent = row(first.main, "Recently added", ["/item/MOVIE", "/item/OTHER"])
  noteRoute("/")
  placeFocus(recent.cards[0])
  activate(recent.cards[0])

  shell()
  noteRoute("/item/MOVIE")
  restoreSeat("/item/MOVIE", true, () => {})

  const back = shell()
  const moved = row(back.main, "Recently added", ["/item/OTHER", "/item/THIRD"])
  noteRoute("/")
  let fellBack = false
  const cancel = restoreSeat("/", true, () => {
    fellBack = true
  })
  run(1600)
  check("a poster that has left its row falls back to that row", active === moved.cards[0], label(active))
  check("the row fallback is not the generic landing", !fellBack)
  cancel()

  // Nothing of the origin is left: only then is the page allowed to land itself.
  clearSeats()
  const favs = shell()
  const board = row(favs.main, "Favorites", ["/item/FAV", "/item/OTHER"])
  noteRoute("/favorites")
  placeFocus(board.cards[0])
  activate(board.cards[0])

  shell()
  noteRoute("/item/FAV")
  restoreSeat("/item/FAV", true, () => {})

  shell()
  noteRoute("/favorites")
  let landed = false
  const cancel2 = restoreSeat("/favorites", true, () => {
    landed = true
  })
  run(6100)
  check("with the row gone as well, the page is allowed to land itself", landed)
  cancel2()
}

/** The rail is navigation, not a place in a page. */
function testRailIsNotASeat() {
  clearSeats()
  const page = shell()
  row(page.main, "Recently added", ["/item/OTHER"])
  noteRoute("/")
  activate(page.rail)
  let landed = false
  const cancel = restoreSeat("/", true, () => {
    landed = true
  })
  check("a press on the rail is not remembered as a position to return to", landed)
  cancel()
}

/** Clearing the records, and the overlay that owns Back, are both left as they were. */
function testClearingAndOverlays() {
  clearSeats()
  const page = shell()
  const recent = row(page.main, "Recently added", ["/item/MOVIE"])
  noteRoute("/")
  placeFocus(recent.cards[0])
  activate(recent.cards[0])
  clearSeats()
  let landed = false
  restoreSeat("/", true, () => {
    landed = true
  })
  check("a cleared record has nothing to return to", landed)

  let closed = false
  const release = ownBack(() => {
    closed = true
    return true
  })
  check("an open toolbar menu or popup still answers Back first", takeBack() === true && closed)
  release()
  check("with nothing open, Back belongs to the page again", takeBack() === false)
}

/**
 * The season page with the remote: Down leaves the seasons for the episode row, Right walks
 * that row, Down leaves it for the actions under the row, and Up climbs back through both.
 */
function testSeasonWalk() {
  clearSeats()
  resetFocusState()
  const page = shell()
  const seasons = row(page.main, "Seasons", ["/item/SERIES?season=S1", "/item/SERIES?season=S2"])
  const block = seasonBlock(page.main)
  noteRoute("/item/SERIES?season=S2")

  placeFocus(seasons.cards[1])
  moveFocus("ArrowDown")
  check("Down leaves the seasons for the episode row", active !== null && block.cards.includes(active), label(active))

  placeFocus(block.cards[0])
  moveFocus("ArrowRight")
  check("Right walks the episode row sideways", active === block.cards[1], label(active))
  moveFocus("ArrowRight")
  check("and keeps walking it", active === block.cards[2], label(active))

  moveFocus("ArrowDown")
  check("Down leaves the episode row for the actions under it", active === block.play || active === block.favorite, label(active))

  placeFocus(block.play)
  moveFocus("ArrowRight")
  check("Right walks the actions band", active === block.favorite, label(active))

  moveFocus("ArrowUp")
  check("Up comes back into the episode row", active !== null && block.cards.includes(active), label(active))
  moveFocus("ArrowUp")
  check("Up again leaves it for the seasons, not for the rail", active !== null && seasons.cards.includes(active), label(active))
}

/**
 * The season page with the remote: the moves the viewer reported broken.
 *
 * Down from the head enters the episode row, Right and Left walk it, Down from the row reaches
 * the cast, Up from the cast comes back to the row, and Up from the row returns to the head. None
 * of it may fall back to the navigation rail while the page has a step of its own in that
 * direction.
 */
function testSeasonPageWalk() {
  clearSeats()
  resetFocusState()
  const page = shell()
  const season = seasonPage(page.main)
  noteRoute("/item/SEASON1")

  placeFocus(season.pills[0])
  moveFocus("ArrowDown")
  check("Down from the head enters the episode row", active !== null && season.block.cards.includes(active), label(active))

  placeFocus(season.block.cards[0])
  moveFocus("ArrowRight")
  check("Right walks the episode row sideways", active === season.block.cards[1], label(active))
  moveFocus("ArrowLeft")
  check("and Left walks it back", active === season.block.cards[0], label(active))

  moveFocus("ArrowDown")
  check("Down from the episode row reaches the cast", active !== null && season.cast.links.includes(active), label(active))

  moveFocus("ArrowUp")
  check("Up from the cast returns to the episode row", active !== null && season.block.cards.includes(active), label(active))

  moveFocus("ArrowUp")
  check("Up from the episode row returns to the head", active !== null && season.pills.includes(active), label(active))
  check("and not to the navigation rail", !(active instanceof El) || !active.closest(".side"), label(active))

  // The season's own band under the row holds no controls, so it is not a stop on the way: the
  // viewer never lands in an empty band, and the row's next step down is the cast.
  placeFocus(season.block.cards[0])
  moveFocus("ArrowDown")
  check("the empty band under the row is never a stop", active !== null && season.cast.links.includes(active), label(active))
}

/**
 * A press of Down from the navigation rail enters the page's own content.
 *
 * The rail sits above the page, so Down from it is the viewer asking for what the page holds -
 * and the answer is the band they were last in, or the first one on screen. A page scrolled down
 * its own length used to answer with whichever band happened to sit nearest the top of the
 * screen, which on a season page is the cast: the remote landed below the episode row the viewer
 * had been browsing, and the row they came for was left above them, unvisited.
 */
function testRailEntry() {
  clearSeats()
  resetFocusState()
  const page = shell()
  const season = seasonPage(page.main)
  noteRoute("/item/SEASON1")

  // The viewer browses the row, and the page is left scrolled down it - the state the remote
  // returns to the rail from. The cast is what is on screen, and the row is above the top.
  placeFocus(season.block.cards[4])
  scrollPage(page.main, 900)
  placeFocus(page.rail)
  const cast = season.cast.links[0]
  const row = season.block.cards[4]
  check(
    "the check is set up the way the bug appeared: the cast is nearer the rail than the row",
    Math.abs(cast.rect.top - page.rail.rect.top) < Math.abs(row.rect.top - page.rail.rect.top) && row.rect.bottom < 0,
    `cast ${cast.rect.top}, row ${row.rect.top}, rail ${page.rail.rect.top}`,
  )

  moveFocus("ArrowDown")
  check(
    "Down from the rail returns to the row the viewer was in, not to the cast below it",
    active !== null && season.block.cards.includes(active),
    label(active),
  )
  check("and the cast is not what it lands on", active !== null && !season.cast.links.includes(active), label(active))
}

/**
 * The season page's episode row with the remote walking it: the row itself is what has to
 * scroll, and the episode the remote lands on has to be inside what the row is showing.
 *
 * The complaint was that the stills run past the right edge of the screen and the row never
 * follows, so the remote ends up on an episode nobody can see. What is checked here is the
 * behaviour that has to hold instead, at every press rather than at the two ends: the episode
 * row is the band that moves, the still the remote lands on is inside the row's own window,
 * the row scrolls whenever that still would otherwise be outside it, the first and last
 * episodes are reached without the row running past its own ends, focus never leaves the row
 * for the navigation, and neither the page nor the season strip above is scrolled by any of it.
 */
function testEpisodeRowScroll() {
  clearSeats()
  resetFocusState()
  const page = shell()
  const seasons = row(page.main, "Seasons", ["/item/SERIES?season=S1", "/item/SERIES?season=S2"])
  const block = episodeRow(page.main, 12)
  noteRoute("/item/SEASON1")

  placeFocus(block.cards[0])
  check("the row starts at its own beginning", block.scroller.scrollLeft === 0, String(block.scroller.scrollLeft))
  check(
    "the row is narrower than its stills, so it has something to scroll",
    block.scroller.scrollWidth > block.scroller.clientWidth,
    `${block.scroller.clientWidth} of ${block.scroller.scrollWidth}`,
  )

  // Right, one press at a time, from the first episode to the last.
  const missed: string[] = []
  let scrolled = 0
  for (let step = 1; step < block.cards.length; step += 1) {
    const card = block.cards[step]
    const before = block.scroller.scrollLeft
    const wasInside = inWindow(block.scroller, card)
    moveFocus("ArrowRight")
    if (active !== card) missed.push(`${step}: landed on ${label(active)}`)
    if (!block.scroller.contains(active)) missed.push(`${step}: focus left the row`)
    if (!inWindow(block.scroller, card)) missed.push(`${step}: still ${step} outside the row's window`)
    if (!wasInside && block.scroller.scrollLeft === before) missed.push(`${step}: the row did not follow`)
    if (block.scroller.scrollLeft !== before) scrolled += 1
  }
  check("Right walks the row a still at a time, each one inside it", missed.length === 0, missed.join("; "))
  check("and the row followed the remote as it went", scrolled > 0, `${scrolled} of ${block.cards.length - 1} presses moved it`)
  check("the last episode the remote reached is inside the row", inWindow(block.scroller, block.cards[11]))
  check(
    "the row stopped at its own end rather than running past it",
    block.scroller.scrollLeft === block.scroller.scrollWidth - block.scroller.clientWidth,
    `${block.scroller.scrollLeft} of ${block.scroller.scrollWidth - block.scroller.clientWidth}`,
  )
  check("focus never left the row for the navigation", !(active instanceof El) || !active.closest(".side"), label(active))

  // One more press at the last episode: nothing moves, and focus is not pushed out of the row.
  const atEnd = block.scroller.scrollLeft
  moveFocus("ArrowRight")
  check("Right at the last episode leaves the remote where it is", active === block.cards[11], label(active))
  check("and does not scroll the row any further", block.scroller.scrollLeft === atEnd, String(block.scroller.scrollLeft))

  // Left, all the way back: the same walk in reverse.
  const back: string[] = []
  for (let step = block.cards.length - 2; step >= 0; step -= 1) {
    const card = block.cards[step]
    const before = block.scroller.scrollLeft
    const wasInside = inWindow(block.scroller, card)
    moveFocus("ArrowLeft")
    if (active !== card) back.push(`${step}: landed on ${label(active)}`)
    if (!block.scroller.contains(active)) back.push(`${step}: focus left the row`)
    if (!inWindow(block.scroller, card)) back.push(`${step}: still ${step} outside the row's window`)
    if (!wasInside && block.scroller.scrollLeft === before) back.push(`${step}: the row did not follow`)
  }
  check("Left walks the row back the same way, each still inside it", back.length === 0, back.join("; "))
  check("and brings the row back to its own beginning", block.scroller.scrollLeft === 0, String(block.scroller.scrollLeft))
  check("the first episode is where the remote is", active === block.cards[0], label(active))

  // One more press at the first episode: nothing moves, and focus is not pushed out of the row.
  moveFocus("ArrowLeft")
  check("Left at the first episode leaves the remote where it is", active === block.cards[0], label(active))
  check("and the row stays at its own beginning", block.scroller.scrollLeft === 0, String(block.scroller.scrollLeft))

  // Nothing else on the page moved: not the strip above, not the page itself.
  check("the season strip above was never scrolled by the episode row", seasons.scroller.scrollLeft === 0, String(seasons.scroller.scrollLeft))
  check("and the page itself was never scrolled sideways", page.main.scrollLeft === 0, String(page.main.scrollLeft))
}

/**
 * The season page's episode row with the remote on it: walking the row must play nothing, and OK on
 * an episode must play the episode the remote was on - not the episode's own page, and not the
 * first episode of the season.
 *
 * The cards carry the app's own destination for an episode in a season's row, so the route the
 * remote's OK follows is the route the app renders, and the id on the card is the one the route
 * names. A move only moves focus; nothing here is played until the viewer confirms a selection.
 */
function testEpisodeRowPlays() {
  clearSeats()
  resetFocusState()
  const page = shell()
  const block = episodeRow(page.main, 4)
  noteRoute("/item/SEASON1")

  // Walking the row: Right and Left move the ring and nothing else.
  placeFocus(block.cards[0])
  const before = activated.length
  moveFocus("ArrowRight")
  moveFocus("ArrowRight")
  moveFocus("ArrowLeft")
  check("walking the episode row plays nothing", activated.length === before, `${activated.length - before} played by a move`)
  check("and the remote is still on an episode of that row", active !== null && block.cards.includes(active), label(active))

  // OK on the third episode: the card the viewer was on is the one that is played.
  const card = block.cards[2]
  placeFocus(card)
  activate(card)
  const href = card.getAttribute("href") || ""
  const id = card.getAttribute("data-episode") || ""
  check("OK on an episode follows the play route", href.startsWith("/play/"), href)
  check("and the route names the episode the remote was on", href.startsWith(`/play/${id}`), href)
  check("so the episode's own page is not a step in playing", !href.startsWith("/item/"), href)
  check(
    "and it is never the first episode of the season",
    href !== block.cards[0].getAttribute("href"),
    `${href} vs ${block.cards[0].getAttribute("href")}`,
  )
}

/**
 * Back from the player returns to the episode that was played, in the episode row it was played
 * from and with the season still being browsed - not to the season card the row belongs to.
 */
function testSeasonBack() {
  clearSeats()
  resetFocusState()
  const first = shell()
  row(first.main, "Seasons", ["/item/SERIES?season=S1", "/item/SERIES?season=S2"])
  const opened = seasonBlock(first.main)
  noteRoute("/item/SERIES?season=S2")
  placeFocus(opened.cards[2])
  activate(opened.cards[2])

  shell()
  noteRoute("/play/EP3?resume=0")
  restoreSeat("/play/EP3?resume=0", true, () => {})

  const back = shell()
  const seasons = row(back.main, "Seasons", ["/item/SERIES?season=S1", "/item/SERIES?season=S2"])
  const block = seasonBlock(back.main)
  noteRoute("/item/SERIES?season=S2")
  let landed = false
  const cancel = restoreSeat("/item/SERIES?season=S2", true, () => {
    landed = true
  })
  run(200)
  check("Back returns to the exact episode, in its own row", active === block.cards[2], label(active))
  check("and not to the season the row belongs to", active !== seasons.cards[1], label(active))
  check("Back is not answered by the generic landing", !landed)
  cancel()
}

/**
 * A collection's page: the grid of titles it holds, opened from a title and returned to by Back
 * - on the same poster, in the same grid, at the same offset.
 */
function testCollectionGrid() {
  clearSeats()
  resetFocusState()
  const ids = Array.from({ length: 9 }, (_, index) => `/item/M${String(index).padStart(2, "0")}`)
  const collection = () => {
    const { main } = shell()
    return { main, board: grid(main, ids) }
  }
  const first = collection()
  noteRoute("/item/BOXSET")
  placeFocus(first.board.cards[5])
  first.main.scrollTop = 620
  activate(first.board.cards[5])

  shell()
  noteRoute("/item/M05")
  restoreSeat("/item/M05", true, () => {})

  const back = collection()
  noteRoute("/item/BOXSET")
  let fellBack = false
  const cancel = restoreSeat("/item/BOXSET", true, () => {
    fellBack = true
  })
  run(200)
  check("Back returns to the same title in the collection", active === back.board.cards[5], label(active))
  check("Back restores the collection's column offset", back.main.scrollTop === 620, String(back.main.scrollTop))
  check("Back is not answered by the generic landing", !fellBack)
  cancel()
}

/**
 * A title's page: the row of collections it is part of, opened from there and returned to by
 * Back, with the row's sideways offset where the viewer left it.
 */
function testCollectionsRow() {
  clearSeats()
  resetFocusState()
  const title = () => {
    const { main } = shell()
    return { main, row: row(main, "Part of", ["/item/BOX1", "/item/BOX2"]) }
  }
  const first = title()
  noteRoute("/item/MOVIE")
  placeFocus(first.row.cards[1])
  first.row.scroller.scrollLeft = 260
  activate(first.row.cards[1])

  shell()
  noteRoute("/item/BOX2")
  restoreSeat("/item/BOX2", true, () => {})

  const back = title()
  noteRoute("/item/MOVIE")
  let fellBack = false
  const cancel = restoreSeat("/item/MOVIE", true, () => {
    fellBack = true
  })
  run(200)
  check("Back returns to the collection the viewer opened", active === back.row.cards[1], label(active))
  check("Back restores the row's sideways offset", back.row.scroller.scrollLeft === 260, String(back.row.scroller.scrollLeft))
  check("Back is not answered by the generic landing", !fellBack)
  cancel()
}

/**
 * A person's page: the filmography, opened from there and returned to by Back - on the same
 * poster, with the row's sideways offset and the column's offset where the viewer left them.
 */
function testPersonFilmography() {
  clearSeats()
  resetFocusState()
  const personPage = () => {
    const { main } = shell()
    detailHero(main)
    const films = row(main, "Movies in Library", ["/item/F1", "/item/F2", "/item/F3", "/item/F4"])
    return { main, films }
  }
  const first = personPage()
  noteRoute("/item/ACTOR")
  placeFocus(first.films.cards[2])
  first.main.scrollTop = 300
  first.films.scroller.scrollLeft = 180
  activate(first.films.cards[2])

  shell()
  noteRoute("/item/F3")
  restoreSeat("/item/F3", true, () => {})

  const back = personPage()
  noteRoute("/item/ACTOR")
  let fellBack = false
  const cancel = restoreSeat("/item/ACTOR", true, () => {
    fellBack = true
  })
  run(200)
  check("Back returns to the same title in the filmography", active === back.films.cards[2], label(active))
  check("Back restores the filmography's sideways offset", back.films.scroller.scrollLeft === 180, String(back.films.scroller.scrollLeft))
  check("Back restores the column offset", back.main.scrollTop === 300, String(back.main.scrollTop))
  check("Back is not answered by the generic landing", !fellBack)
  cancel()
}

/**
 * The whole journey, and Back out of it one level at a time: a title, the actor it names, a title
 * of theirs, and then back to the filmography card that was opened and on to the actor it started
 * from. Nothing here is a second memory of its own - both steps are the seat the page was left on.
 */
function testPersonChain() {
  clearSeats()
  resetFocusState()
  const movie = () => {
    const { main } = shell()
    detailHero(main)
    const cast = people(main, ["ACTOR_A", "ACTOR_B", "ACTOR_C"])
    return { main, cast }
  }
  const personPage = () => {
    const { main } = shell()
    detailHero(main)
    const films = row(main, "Movies in Library", ["/item/F1", "/item/F2"])
    return { main, films }
  }

  const first = movie()
  noteRoute("/item/MOVIE")
  placeFocus(first.cast.links[1])
  activate(first.cast.links[1])

  const opened = personPage()
  noteRoute("/item/ACTOR_B")
  let landed = false
  restoreSeat("/item/ACTOR_B", true, () => {
    landed = true
  })
  check("the actor's page opens with its own landing", landed)
  placeFocus(opened.films.cards[1])
  activate(opened.films.cards[1])

  shell()
  noteRoute("/item/F2")
  restoreSeat("/item/F2", true, () => {})

  const backToPerson = personPage()
  noteRoute("/item/ACTOR_B")
  let fellBackToPerson = false
  const cancelPerson = restoreSeat("/item/ACTOR_B", true, () => {
    fellBackToPerson = true
  })
  run(200)
  check("the first Back returns to the title of theirs that was opened", active === backToPerson.films.cards[1], label(active))
  check("the first Back is not answered by the generic landing", !fellBackToPerson)
  cancelPerson()

  const backToMovie = movie()
  noteRoute("/item/MOVIE")
  let fellBackToMovie = false
  const cancelMovie = restoreSeat("/item/MOVIE", true, () => {
    fellBackToMovie = true
  })
  run(200)
  check("the second Back returns to the title it started from, on the actor it named", active === backToMovie.cast.links[1], label(active))
  check("the second Back is not answered by the generic landing", !fellBackToMovie)
  cancelMovie()
}

/** A director is reachable in the crew row, and Back returns to that director. */
function testCrewRow() {
  clearSeats()
  resetFocusState()
  const movie = () => {
    const { main } = shell()
    detailHero(main)
    people(main, ["ACTOR_A", "ACTOR_B"])
    const crew = people(main, ["DIRECTOR", "WRITER"], "Crew", 800)
    return { main, crew }
  }
  const first = movie()
  noteRoute("/item/MOVIE")
  placeFocus(first.crew.links[0])
  activate(first.crew.links[0])

  shell()
  noteRoute("/item/DIRECTOR")
  restoreSeat("/item/DIRECTOR", true, () => {})

  const back = movie()
  noteRoute("/item/MOVIE")
  let fellBack = false
  const cancel = restoreSeat("/item/MOVIE", true, () => {
    fellBack = true
  })
  run(200)
  check("Back returns to the director in the crew row", active === back.crew.links[0], label(active))
  check("Back does not land on the writer beside them", active !== back.crew.links[1], label(active))
  check("Back is not answered by the generic landing", !fellBack)
  cancel()
}

/** A title's genre and studio labels, as its page draws them: a row of doors. */
function pills(main: El, hrefs: string[], top = 300) {
  const row = new El("p", "meta-links genre-pills")
  const links = hrefs.map((href, index) => {
    const link = new El("a", "").attr("href", href)
    link.place(top, 40 + index * 150, 140, 44)
    row.add(link)
    return link
  })
  main.add(row)
  return { row, links }
}

/**
 * A genre is a door, and Back comes out of it the way it went in: the label opens the library it
 * lives in narrowed to that genre, a result opens the title it names, and Back unwinds through the
 * results to the label that was pressed - one level at a time, on the seat each page was left on.
 */
function testGenreDiscovery() {
  clearSeats()
  resetFocusState()
  const genreRoute = "/library/LIB?genre=G1&genreName=Science%20Fiction"
  const ids = Array.from({ length: 8 }, (_, index) => `/item/R${index}`)
  const titlePage = () => {
    const { main } = shell()
    detailHero(main)
    const labels = pills(main, ["/library/LIB?genre=G2&genreName=Drama", genreRoute])
    return { main, labels }
  }
  const results = () => {
    const { main } = shell()
    return { main, board: grid(main, ids) }
  }

  const first = titlePage()
  noteRoute("/item/MOVIE")
  placeFocus(first.labels.links[1])
  first.main.scrollTop = 260
  activate(first.labels.links[1])

  const opened = results()
  noteRoute(genreRoute)
  let landed = false
  restoreSeat(genreRoute, true, () => {
    landed = true
  })
  check("the genre's results open with their own landing", landed)
  placeFocus(opened.board.cards[4])
  opened.main.scrollTop = 700
  activate(opened.board.cards[4])

  shell()
  noteRoute("/item/R4")
  restoreSeat("/item/R4", true, () => {})

  const backToResults = results()
  noteRoute(genreRoute)
  let fellBack = false
  const cancelResults = restoreSeat(genreRoute, true, () => {
    fellBack = true
  })
  run(200)
  check("Back returns to the same title in the genre's results", active === backToResults.board.cards[4], label(active))
  check("Back restores the results' column offset", backToResults.main.scrollTop === 700, String(backToResults.main.scrollTop))
  check("Back is not answered by the generic landing", !fellBack)
  cancelResults()

  const backToTitle = titlePage()
  noteRoute("/item/MOVIE")
  let fellBackTitle = false
  const cancelTitle = restoreSeat("/item/MOVIE", true, () => {
    fellBackTitle = true
  })
  run(200)
  check("and then to the genre label it was pressed from", active === backToTitle.labels.links[1], label(active))
  check("Back does not land on the other genre beside it", active !== backToTitle.labels.links[0], label(active))
  check("the second Back is not answered by the generic landing", !fellBackTitle)
  cancelTitle()
}

/** A studio is the same door, on the same page, with the studio's own id. */
function testStudioDiscovery() {
  clearSeats()
  resetFocusState()
  const studioRoute = "/library/LIB?studio=S1&studioName=A24"
  const titlePage = () => {
    const { main } = shell()
    detailHero(main)
    const labels = pills(main, ["/library/LIB?genre=G1&genreName=Drama", studioRoute])
    return { main, labels }
  }
  const first = titlePage()
  noteRoute("/item/MOVIE")
  placeFocus(first.labels.links[1])
  activate(first.labels.links[1])

  const opened = shell()
  const board = grid(opened.main, ["/item/R1", "/item/R2"])
  noteRoute(studioRoute)
  restoreSeat(studioRoute, true, () => {})
  placeFocus(board.cards[0])
  activate(board.cards[0])

  shell()
  noteRoute("/item/R1")
  restoreSeat("/item/R1", true, () => {})

  const back = titlePage()
  noteRoute("/item/MOVIE")
  let fellBack = false
  const cancel = restoreSeat("/item/MOVIE", true, () => {
    fellBack = true
  })
  run(200)
  check("Back returns to the studio label the viewer pressed", active === back.labels.links[1], label(active))
  check("Back is not answered by the generic landing", !fellBack)
  cancel()
}

// ---------------------------------------------------------------------------
// What the remote can reach has to be drawn when it is reached
// ---------------------------------------------------------------------------

/**
 * A panel that has faded out is not a target.
 *
 * The player's chrome is the case that matters: it dims rather than unmounting, so its transport
 * buttons and its seek bar stay in the tree while nothing is painted. Without `inert` they are
 * ordinary focusable controls with a rect of their own, and a press moves the focus ring onto one
 * of them - the ring is then nowhere the viewer can see it, and the press after that starts from
 * a control they never chose. The engine already skips anything inside `[inert]`; this is the
 * check that the panel is marked, and that the skipping really happens.
 */
function testFadedPanel() {
  clearSeats()
  resetFocusState()
  const { main } = shell()
  const strip = row(main, "Continue watching", ["/item/A", "/item/B"])
  placeFocus(strip.cards[0])

  // The player's chrome, faded out but still in the tree, directly under the card.
  const chrome = new El("div", "chrome hidden").attr("inert", "")
  const transport = new El("button", "transport-btn")
  transport.place(400, 300, 60, 60)
  chrome.add(transport)
  main.add(chrome)

  moveFocus("ArrowDown")
  check("a faded panel does not collect the focus ring", active !== transport, label(active))
  check(
    "and the engine does not offer its controls at all",
    !focusables().includes(transport as unknown as HTMLElement),
    label(transport),
  )

  // The same button is offered again the moment the panel is on screen: without this the two
  // checks above would pass on a button that was never reachable in the first place.
  chrome.attr("inert", null)
  check(
    "the same control is offered again as soon as the panel is not inert",
    focusables().includes(transport as unknown as HTMLElement),
    label(transport),
  )
}

/** The declarations the checks above rest on, read as they are written. */
function testFocusDeclarations() {
  const css = readFileSync("src/styles.css", "utf8")
  const player = readFileSync("src/pages/Player.tsx", "utf8")

  check(
    "the player's chrome leaves the remote's reach while it is faded out",
    /chrome hidden"[\s\S]{0,600}?inert=\{!showChrome\}/.test(player),
    "Player.tsx",
  )
  check(
    "and it is never faded out from under the focus the viewer is holding",
    /chromeRef\.current[\s\S]{0,200}?contains\(document\.activeElement\)/.test(player),
    "Player.tsx",
  )
  // The stylesheet takes the browser's own outline away with a global `:focus` rule, so every
  // control the remote can land on has to draw a ring of its own. These three did not.
  for (const control of [".text-link", ".more-link", ".center-play"]) {
    check(
      `${control} draws a focus ring`,
      css.includes(`${control}:focus`) && css.includes(`${control}.dpad-focus`),
      "styles.css",
    )
  }
  // The episode row scrolls because the strip is a scroll container narrower than its contents.
  // A grid item is as wide as its contents unless it is told otherwise, so the row has to say
  // so: without it `scrollWidth` and `clientWidth` are the same number and the remote can land
  // on a still the page has clipped. The stills keep the width they are designed at, too - the
  // row is not fixed by shrinking every episode until the season fits on one screen.
  check(
    "the episode row is told it may be narrower than the stills it holds",
    /\.episode-scroller\s*\{[^}]*min-width:\s*0/.test(css),
    "styles.css",
  )
  check(
    "and its stills keep the width they are designed at",
    /\.episode\s*\{[^}]*width:\s*360px/.test(css) && /\.episode\s*\{[^}]*flex:\s*0 0 auto/.test(css),
    "styles.css",
  )
  // The still inside the card is 16:9 artwork, drawn by the one shared rule: a card that grew
  // without it would stretch a picture into the frame instead of showing it.
  check(
    "and the still keeps the 16:9 shape the artwork is drawn in",
    /\.card\.wide \.card-art,\s*\.episode-art,[\s\S]{0,80}?aspect-ratio:\s*16\s*\/\s*9/.test(css),
    "styles.css",
  )
  // The page's own content boundary, taken once. The season's episode block and the actions under
  // the row used to state insets of their own - 0 and 40 - which left the episode's synopsis 32
  // design units to the left of the heading above it and the Play button 8 to the right of the
  // still below it, and moved again at 1440p and 4K, where the boundary grows with the panel.
  check(
    "the season's episode block takes the page's own content boundary",
    /\.episode-spot,\s*[\s\S]{0,400}?padding-inline:\s*var\(--strip-pad\)/.test(css),
    "styles.css",
  )
  check(
    "and states no inset of its own",
    /\.episode-spot\s*\{[^}]*\}/.test(css) && !/\.episode-spot\s*\{[^}]*padding/.test(css),
    "styles.css",
  )
  check(
    "the actions under the row begin on that same boundary",
    /\.episode-actions\s*\{[^}]*padding-inline:\s*var\(--strip-pad\)/.test(css),
    "styles.css",
  )
  // A title page has nothing of its own to focus while the server answers, and the navigation
  // used to win the landing there: the viewer opened a season and the remote sat on the rail
  // above the episode row they came for. The landing has to hold the rail only as a place to
  // keep the remote alive, keep looking for the page's own content, and let go of it the moment
  // the viewer presses anything themselves.
  const nav = readFileSync("src/components/RemoteNav.tsx", "utf8")
  check(
    "the landing holds the rail only while the page has no content of its own",
    /if \(!held && items\[0\]\)[\s\S]{0,200}?placeFocus\(items\[0\]\)/.test(nav),
    "RemoteNav.tsx",
  )
  check(
    "and keeps looking for the page's own content rather than settling for it",
    /attempts < LAND_LOOKS/.test(nav) && /const LAND_LOOKS = 40/.test(nav),
    "RemoteNav.tsx",
  )
  check(
    "while a press of the viewer's own ends the looking",
    /window\.addEventListener\("keydown", takenOver, true\)/.test(nav) && /current !== held/.test(nav),
    "RemoteNav.tsx",
  )
}

installDom()
trackSeats()
testHomeRow()
testHeroAndFirstRow()
testActorCarousel()
testLibraryGrid()
testSearchResult()
testNestedBack()
testDelayedList()
testMissingTarget()
testRailIsNotASeat()
testSeasonWalk()
testSeasonPageWalk()
testRailEntry()
testEpisodeRowScroll()
testEpisodeRowPlays()
testSeasonBack()
testCollectionGrid()
testCollectionsRow()
testPersonFilmography()
testPersonChain()
testCrewRow()
testGenreDiscovery()
testStudioDiscovery()
testClearingAndOverlays()
testFadedPanel()
testFocusDeclarations()
console.log(failures === 0 ? "\nAll navigation checks passed." : `\n${failures} navigation check(s) failed.`)
if (failures > 0) throw new Error(`${failures} navigation check(s) failed`)

