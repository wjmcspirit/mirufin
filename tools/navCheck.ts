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
  noteBackKeydown,
  ownBack,
  placeFocus as placeFocusOn,
  resetFocusState,
  restoreSeat,
  takeBack,
  trackSeats,
} from "../src/lib/remote"
import { episodePlayHref } from "../src/lib/seasons"
import { focusedMenuOption, insideMenu, menuOptions, menuReturnTarget, menuStart, menuStep, revealMenuOption } from "../src/lib/playerMenu"

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

  /** What the browser reports for `offsetTop`: measured from the offsetParent's padding edge. */
  offsetTopOverride: number | null = null

  get offsetTop() {
    return this.offsetTopOverride ?? this.rect.top
  }

  get offsetHeight() {
    return this.rect.height
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
 * A library page as the app draws it: the head with the library's own count, the toolbar at the
 * right of it - View, Sort, Filter and A-Z, the controls a viewer presses Down from - and the
 * grid of posters under them, in rows.
 *
 * The geometry is the one that produced the reported defect: the toolbar is at the right of the
 * header, so the poster nearest it is the last of the first row and the first poster is the
 * furthest from it. A press of Down answered with the nearest item therefore lands on the
 * right-hand end of the row, which is what the checks below are written against.
 */
function libraryPage(main: El, columns = 6, rows = 4, cardWidth = 168) {
  const cardHeight = Math.round(cardWidth * 1.5)
  const head = new El("header", "page-head library-head")
  head.place(60, 0, 1920, 220)
  const icons = new El("div", "library-icons")
  icons.place(140, 1400, 250, 44)
  const labels = ["View", "Sort", "Filter", "A to Z"]
  const tools = labels.map((label, index) => {
    const holder = new El("div", "tool")
    holder.place(140, 1400 + index * 50, 44, 44)
    const button = new El("button", index === labels.length - 1 ? "tool-btn tool-az" : "tool-btn").attr("aria-label", label)
    button.text = label
    button.place(140, 1400 + index * 50, 44, 44)
    holder.add(button)
    icons.add(holder)
    return button
  })
  head.add(icons)
  main.add(head)
  const board = new El("div", "grid poster size-medium")
  board.place(300, 0, 1920, rows * (cardHeight + 28))
  const cards = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const card = new El("a", "card poster").attr("href", `/item/M${index + 1}`)
    card.place(300 + row * (cardHeight + 28), 64 + column * (cardWidth + 14), cardWidth, cardHeight)
    board.add(card)
    return card
  })
  main.add(board)
  return { head, icons, tools, board, cards }
}

/** Where a control's own centre is, as the engine measures it. */
function centre(node: El) {
  return node.rect.left + node.rect.width / 2
}

/**
 * The library toolbar and the grid under it: Down from any of the toolbar's controls enters the
 * grid at its first poster, and Up comes back to the control the viewer left.
 *
 * The viewer's complaint was that Down from the toolbar - the poster-size control, the sort
 * control, the filter control or A-Z - put the remote on a title at the far right of the first
 * row instead of the first title on the left, which is what happens when the press is answered
 * by the item nearest the control it left rather than by the beginning of the grid.
 */
function testLibraryToolbar() {
  clearSeats()
  resetFocusState()
  const page = shell()
  const library = libraryPage(page.main)
  noteRoute("/library/movies")
  const first = library.cards[0]
  const lastOfRow = library.cards[5]
  const az = library.tools[library.tools.length - 1]
  check(
    "the check is set up the way the bug appeared: the last poster of the first row is the one nearest the toolbar",
    Math.abs(centre(lastOfRow) - centre(az)) < Math.abs(centre(first) - centre(az)),
    `toolbar centre ${centre(az)}, first poster ${centre(first)}, last of the row ${centre(lastOfRow)}`,
  )

  for (const tool of library.tools) {
    const control = tool.getAttribute("aria-label") || ""
    placeFocus(tool)
    moveFocus("ArrowDown")
    check(`Down from the ${control} control lands on the first poster of the first row`, active === first, label(active))
    moveFocus("ArrowUp")
    check(`Up from that poster returns to the ${control} control`, active === tool, label(active))
  }

  // The grid is still walked the way it always was: sideways along a row, and a row at a time.
  placeFocus(first)
  moveFocus("ArrowRight")
  check("Right walks the first row", active === library.cards[1], label(active))
  moveFocus("ArrowRight")
  check("and keeps walking it", active === library.cards[2], label(active))
  moveFocus("ArrowLeft")
  moveFocus("ArrowLeft")
  check("Left walks it back to its first poster", active === first, label(active))
  moveFocus("ArrowDown")
  check("Down moves to the same column of the next row", active === library.cards[6], label(active))
  moveFocus("ArrowDown")
  check("and on to the row under it", active === library.cards[12], label(active))
  moveFocus("ArrowUp")
  check("Up comes back a row", active === library.cards[6], label(active))
  moveFocus("ArrowUp")
  check("and back to the first row", active === first, label(active))

  // Up from the first row, from a column the viewer walked to, still returns to the toolbar.
  placeFocus(library.cards[7])
  moveFocus("ArrowUp")
  moveFocus("ArrowUp")
  check(
    "Up from the first row returns to a toolbar control, whichever column the viewer is in",
    active !== null && library.tools.includes(active),
    label(active),
  )
}

/**
 * The same press on the shapes a library takes: a different poster size, a different number of
 * columns - which is what sorting or filtering to a shorter list leaves - a grid the viewer has
 * scrolled down, and the other grid band the app shares this navigation with.
 */
function testLibraryToolbarShapes() {
  const cases: { name: string; columns: number; rows: number; width: number; scroll: number }[] = [
    { name: "a large-poster grid", columns: 5, rows: 4, width: 220, scroll: 0 },
    { name: "a small-poster grid", columns: 8, rows: 4, width: 132, scroll: 0 },
    { name: "a grid narrowed to a handful of titles", columns: 3, rows: 2, width: 168, scroll: 0 },
    { name: "a grid the viewer has scrolled down", columns: 6, rows: 6, width: 168, scroll: 620 },
  ]
  for (const entry of cases) {
    clearSeats()
    resetFocusState()
    const page = shell()
    const library = libraryPage(page.main, entry.columns, entry.rows, entry.width)
    noteRoute("/library/tvshows")
    if (entry.scroll) scrollPage(page.main, entry.scroll)
    // The first poster the viewer can see: the first card of the first row that is on screen,
    // which is where a press of Down into a grid the viewer has scrolled starts.
    const expected = library.cards.find((card) => card.rect.bottom > 8 && card.rect.top < 1080 - 8)
    for (const tool of library.tools) {
      const control = tool.getAttribute("aria-label") || ""
      placeFocus(tool)
      moveFocus("ArrowDown")
      check(`${entry.name}: Down from the ${control} control lands on the first poster of the first visible row`, active === expected, label(active))
    }
  }

  // A collection's own page draws the other grid band, and it is entered the same way.
  clearSeats()
  resetFocusState()
  const page = shell()
  const library = libraryPage(page.main, 4, 3)
  library.board.className = "card-board"
  noteRoute("/item/BOXSET")
  placeFocus(library.tools[0])
  moveFocus("ArrowDown")
  check("a collection's board is entered at its own first card as well", active === library.cards[0], label(active))
}


/**
 * The Favorites page as the app draws it: the hero at the top with its Play, Details, Favorite and
 * Trailers actions, the heading beside the All/Movies/TV Shows filter row, and the poster board
 * under both.
 *
 * The filters sit at the right of the heading, as they do on the television, so their column is
 * nothing like the hero's: a press answered by the nearest control would put the remote on a filter
 * chosen by where the hero button happened to be. Both rows are marked as stacks, which is what
 * makes them one vertical order - Down walks each row a control at a time, and leaves it at its end.
 */
function favoritesPage(main: El, columns = 6, rows = 3, cardWidth = 168) {
  const cardHeight = Math.round(cardWidth * 1.5)
  const heroSection = new El("section", "hero stage-copy")
  heroSection.place(40, 0, 1920, 520)
  const copy = new El("div", "hero-copy")
  const actions = new El("div", "actions").attr("data-nav-flow", "stack")
  const labels = ["Play", "Details", "Favorite", "Trailers"]
  const controls = labels.map((label, index) => {
    const control = label === "Favorite" || label === "Trailers" ? new El("button", "btn icon-btn") : new El("a", "btn")
    control.text = label
    if (label === "Play") {
      control.className = "btn btn-primary"
      control.attr("href", "/play/MOVIE?resume=1")
    } else if (label === "Details") {
      control.attr("href", "/item/MOVIE")
    }
    control.place(560, 48 + index * 150, 140, 48)
    actions.add(control)
    return control
  })
  copy.add(actions)
  heroSection.add(copy)
  main.add(heroSection)

  const head = new El("header", "page-head favorites-head")
  head.place(600, 0, 1920, 96)
  const filterRow = new El("div", "filter-row").attr("data-nav-flow", "stack")
  filterRow.place(620, 1350, 430, 44)
  const filters = ["All", "Movies", "TV Shows"].map((label, index) => {
    const button = new El("button", "").attr("aria-pressed", index === 0 ? "true" : "false")
    button.text = label
    button.place(626, 1360 + index * 140, 120, 32)
    filterRow.add(button)
    return button
  })
  head.add(filterRow)
  main.add(head)

  const board = new El("div", "card-board size-medium")
  board.place(700, 0, 1920, rows * (cardHeight + 28))
  const cards = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const card = new El("a", "card poster").attr("href", `/item/F${index + 1}`)
    card.place(700 + row * (cardHeight + 28), 32 + column * (cardWidth + 14), cardWidth, cardHeight)
    board.add(card)
    return card
  })
  main.add(board)
  return { heroSection, actions, controls, head, filterRow, filters, board, cards }
}

/**
 * The Favorites page walked with the remote: Down from Play goes through the hero's own actions,
 * then the filter row, then the first poster of the grid - and Up climbs back the same way.
 *
 * This is the reported defect: the filter row was not a band the navigation engine knew, so Down
 * from Trailers answered with the first poster directly, and a fix that treats the row as an
 * ordinary strip lands on the filter in the hero button's column - TV Shows - instead of on All.
 * Both ends of both stacks are checked, along with the sideways presses that must not change.
 */
function testFavoritesWalk() {
  clearSeats()
  resetFocusState()
  const page = shell()
  const favorites = favoritesPage(page.main)
  noteRoute("/favorites")
  const [play, details, favorite, trailers] = favorites.controls
  const [all, movies, shows] = favorites.filters
  const first = favorites.cards[0]

  // The page opens on the hero's Play, and Down walks the order the page is built in.
  placeFocus(play)
  const down: [string, El][] = [
    ["Details", details],
    ["Favorite", favorite],
    ["Trailers", trailers],
    ["All", all],
    ["Movies", movies],
    ["TV Shows", shows],
    ["the first poster at the left of the first row", first],
  ]
  for (const [name, expected] of down) {
    moveFocus("ArrowDown")
    check(`Down reaches ${name}`, active === expected, label(active))
  }

  // The grid keeps the navigation it always had: sideways along a row, and a row at a time.
  moveFocus("ArrowRight")
  check("Right walks the first row of posters", active === favorites.cards[1], label(active))
  moveFocus("ArrowRight")
  check("and keeps walking it", active === favorites.cards[2], label(active))
  moveFocus("ArrowDown")
  check("Down moves to the same column of the next row", active === favorites.cards[8], label(active))
  moveFocus("ArrowDown")
  check("and on to the row under it", active === favorites.cards[14], label(active))
  moveFocus("ArrowUp")
  check("Up comes back a row", active === favorites.cards[8], label(active))
  moveFocus("ArrowUp")
  check("and back to the first row", active === favorites.cards[2], label(active))
  moveFocus("ArrowLeft")
  moveFocus("ArrowLeft")
  check("Left walks it back to its first poster", active === first, label(active))

  // Up from the first poster returns to the last filter, then up the filter row, then to the hero
  // action the viewer came down from.
  moveFocus("ArrowUp")
  check("Up from the first poster returns to TV Shows", active === shows, label(active))
  moveFocus("ArrowUp")
  check("Up from TV Shows returns to Movies", active === movies, label(active))
  moveFocus("ArrowUp")
  check("Up from Movies returns to All", active === all, label(active))
  moveFocus("ArrowUp")
  check("Up from All returns to the hero's last action", active === trailers, label(active))
  moveFocus("ArrowUp")
  check("and Up from there walks the hero's actions back", active === favorite, label(active))

  // Sideways inside both stacks remains the ordinary row movement.
  placeFocus(play)
  moveFocus("ArrowRight")
  check("Right walks the hero's actions", active === details, label(active))
  moveFocus("ArrowLeft")
  check("and Left walks them back", active === play, label(active))
  placeFocus(all)
  moveFocus("ArrowRight")
  moveFocus("ArrowRight")
  check("Right walks the filters to TV Shows", active === shows, label(active))
  moveFocus("ArrowRight")
  check("and stops at the end of the filter row", active === shows, label(active))
  moveFocus("ArrowLeft")
  check("Left walks the filters back", active === movies, label(active))

  // The exact transition the report named, on its own: from Trailers, Down is All and nothing else.
  placeFocus(trailers)
  moveFocus("ArrowDown")
  check("Down from Trailers focuses All", active === all, label(active))
  check("not TV Shows", active !== shows, label(active))
  check("and not a poster", active !== null && !favorites.cards.includes(active), label(active))

  // A page the viewer has scrolled enters the grid at its first visible row, still at the left.
  clearSeats()
  resetFocusState()
  const scrolled = shell()
  const lower = favoritesPage(scrolled.main, 6, 5)
  scrollPage(scrolled.main, 420)
  noteRoute("/favorites")
  placeFocus(lower.filters[2])
  moveFocus("ArrowDown")
  const expected = lower.cards.find((card) => card.rect.bottom > 8 && card.rect.top < 1080 - 8)
  check("Down from the last filter enters a scrolled grid at its first visible poster", active === expected, label(active))
  moveFocus("ArrowUp")
  check("and Up from it returns to the last filter", active === lower.filters[2], label(active))
}


/**
 * The player's subtitle popup as it is drawn: a capped, scrolling `.pop-menu` above the transport,
 * with Off and every track among the style rows, and the chip that opened it in the second row.
 * Rows are 48 high with 8 between them and the popup shows 160 at a time, so a long list has to
 * scroll to keep the row the remote is on visible.
 */
function playerPopup(main: El, labels: string[], currentIndex: number, defaultIndex = -1) {
  const pop = new El("div", "pop-menu")
  pop.place(300, 1200, 360, 160)
  pop.clientHeight = 160
  pop.scrollHeight = labels.length * 56
  const buttons = labels.map((label, index) => {
    const button = new El("button", "")
    button.text = label
    button.place(300 + index * 56, 1210, 340, 48)
    button.offsetTopOverride = index * 56
    if (index === currentIndex) button.attr("data-menu-current", "true")
    if (index === defaultIndex) button.attr("data-menu-default", "true")
    pop.add(button)
    return button
  })
  main.add(pop)
  const transport = new El("div", "transport-secondary")
  const chip = new El("button", "transport-chip")
  chip.text = "Subtitles"
  chip.place(900, 1300, 160, 48)
  const fallback = new El("button", "transport-chip")
  fallback.text = "Speed"
  fallback.place(900, 1480, 120, 48)
  transport.add(chip, fallback)
  main.add(transport)
  return { pop, buttons, chip, fallback }
}

/**
 * The subtitle popup with the remote: it opens on the current choice, walks every row without
 * leaving the popup, scrolls a long list, and hands focus back to the chip that opened it.
 *
 * The reported defect was that the popup opened on the first `aria-pressed` control - the
 * subtitle-size button - so the first OK changed the size of the captions instead of choosing a
 * track. The other half of it was Back: the player answered the keydown but did not claim the
 * native back press or record that it had answered it, so the same press could close the menu and
 * then leave playback. Both are checked here, along with the rows and the scrolling.
 */
function testPlayerPopup() {
  clearSeats()
  resetFocusState()
  const page = shell()
  const popup = playerPopup(page.main, ["Small", "Medium", "Large", "Higher", "Lower", "Off", "English", "Français (Forced) — SDH"], 6, 5)
  noteRoute("/play/MOVIE")
  const options = menuOptions(page.main)
  check("the subtitle popup offers every row it draws", options.length === popup.buttons.length, `${options.length} of ${popup.buttons.length}`)
  check("the popup opens on the current subtitle choice", menuStart(options) === popup.buttons[6], label(menuStart(options)))
  popup.buttons[6].attr("data-menu-current", "false")
  check("and on Off when the remembered track is no longer in the plan", menuStart(options) === popup.buttons[5], label(menuStart(options)))
  popup.buttons[6].attr("data-menu-current", "true")
  placeFocus(popup.buttons[6])
  check("the current row holds the remote", focusedMenuOption(options) === popup.buttons[6], label(focusedMenuOption(options)))
  check("Down walks to the next row", menuStep(options, popup.buttons[6], "ArrowDown") === popup.buttons[7], label(menuStep(options, popup.buttons[6], "ArrowDown")))
  check("Up walks back to Off", menuStep(options, popup.buttons[6], "ArrowUp") === popup.buttons[5], label(menuStep(options, popup.buttons[6], "ArrowUp")))
  check("Up at the first row stays there", menuStep(options, popup.buttons[0], "ArrowUp") === popup.buttons[0], label(menuStep(options, popup.buttons[0], "ArrowUp")))
  check("Down at the last row stays there", menuStep(options, popup.buttons[7], "ArrowDown") === popup.buttons[7], label(menuStep(options, popup.buttons[7], "ArrowDown")))
  check("a lost focus starts again on the current row", menuStep(options, null, "ArrowDown") === popup.buttons[6], label(menuStep(options, null, "ArrowDown")))

  placeFocus(popup.chip)
  check("a control behind the popup is not mistaken for one of its rows", focusedMenuOption(options) === null, label(focusedMenuOption(options)))
  check("and the popup tells its own controls from the player's", insideMenu(popup.buttons[6]) && !insideMenu(popup.chip))

  popup.pop.scrollTop = 0
  revealMenuOption(popup.buttons[6])
  check("moving to Off scrolls it into the popup's window", popup.pop.scrollTop === 232, String(popup.pop.scrollTop))
  revealMenuOption(popup.buttons[7])
  check("and the last row scrolls further", popup.pop.scrollTop === 288, String(popup.pop.scrollTop))
  revealMenuOption(popup.buttons[0])
  check("coming back to the first row scrolls up", popup.pop.scrollTop === 0, String(popup.pop.scrollTop))

  check("the remote returns to the chip that opened the popup", menuReturnTarget(popup.chip, page.main) === popup.chip, label(menuReturnTarget(popup.chip, page.main)))
  popup.chip.connected = false
  check("and to the transport when that chip has gone", menuReturnTarget(popup.chip, page.main) === popup.fallback, label(menuReturnTarget(popup.chip, page.main)))

  const player = readFileSync("src/pages/Player.tsx", "utf8")
  const css = readFileSync("src/styles.css", "utf8")
  check("the open popup claims Back in the shared overlay layer", /ownBack\(\(\) => \{[\s\S]{0,80}?closeMenu\(\)/.test(player), "Player.tsx")
  check(
    "and the keydown path tells the shared layer it answered Back",
    /noteBackKeydown\(\)/.test(player) && /stopImmediatePropagation/.test(player),
    "Player.tsx",
  )
  check(
    "Back closes the popup before the player is left",
    /if \(menuOpen\.current\) \{\s*closeMenu\(\)\s*return\s*\}\s*leave\(\)/.test(player),
    "Player.tsx",
  )
  check(
    "the popup keeps every direction and Tab to itself",
    /const options = menuOptions\(rootRef\.current\)/.test(player) &&
      /key === "ArrowLeft" \|\| key === "ArrowRight" \|\| key === "Tab"/.test(player) &&
      /event\.preventDefault\(\)[\s\S]{0,80}?event\.stopPropagation\(\)/.test(player),
    "Player.tsx",
  )
  check(
    "and OK cannot activate a control behind the popup when focus is lost",
    /if \(!focusedMenuOption\(options\)\) \{\s*event\.preventDefault\(\)/.test(player),
    "Player.tsx",
  )
  check(
    "focus is restored only after the popup leaves the tree",
    /if \(menu \|\| !restoreMenu\.current\) return/.test(player) && /menuReturnTarget\(menuButton\.current, rootRef\.current\)/.test(player),
    "Player.tsx",
  )
  check(
    "the popup draws Off and every track, marking the current one",
    /subtitleOptions\(plan\.subtitles, subtitleIndex\)/.test(player) &&
      /data-menu-current=\{option\.current \? "true" : undefined\}/.test(player) &&
      /data-menu-default=\{option\.index == null \? "true" : undefined\}/.test(player),
    "Player.tsx",
  )
  check("audio rows keep their own current track", /audioOptions\(plan\.audio, audioIndex\)/.test(player), "Player.tsx")
  check(
    "a title with no subtitle tracks does not offer an empty subtitles menu",
    /plan && plan\.subtitles\.length > 0/.test(player),
    "Player.tsx",
  )
  check(
    "choosing a row applies the subtitle and closes the popup",
    /function chooseSubtitle\(index: number \| null, burn: boolean\)[\s\S]{0,400}?setSubtitleIndex\(index\)[\s\S]{0,80}?closeMenu\(\)/.test(player) &&
      /onClick=\{\(\) => chooseSubtitle\(option\.index, option\.burn\)\}/.test(player),
    "Player.tsx",
  )
  check(
    "and the chosen track reaches both playback engines",
    /nativePlayer\.subtitle\(\{ url: choice\.src \}\)/.test(player) && /video\.textTracks\[track\]\.mode =/.test(player),
    "Player.tsx",
  )
  check(
    "audio selection still closes and reports to the native player",
    /function chooseAudio\(index: number\)[\s\S]{0,200}?closeMenu\(\)/.test(player) && /nativePlayer\.selectAudio\(\{ ordinal \}\)/.test(player),
    "Player.tsx",
  )
  check(
    "the popup scrolls and long names wrap",
    /\.pop-menu \{[^}]*overflow: auto/.test(css) && /\.pop-menu \{[^}]*overflow-wrap: anywhere/.test(css),
    "styles.css",
  )

  // The shared Back layer, exercised the way the player uses it: the open popup claims the native
  // press, and a keydown that has already answered it keeps the native echo from being acted on
  // again. That echo was the second half of the reported defect - one press closed the menu and
  // then left playback.
  let closed = 0
  const release = ownBack(() => {
    closed += 1
    return true
  })
  check("an open popup claims the native Back press", takeBack() === true && closed === 1)
  release()
  noteBackKeydown()
  let echoed = 0
  const releaseEcho = ownBack(() => {
    echoed += 1
    return true
  })
  check("the native echo of a Back already answered is not acted on again", takeBack() === true && echoed === 0)
  releaseEcho()
  run(300)
  const releaseLater = ownBack(() => {
    closed += 1
    return true
  })
  check("and a later press is answered by the popup again", takeBack() === true && closed === 2)
  releaseLater()
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

  // A rating's star is one colour on every screen that draws a rating: the app's own gold, taken
  // from the one token. The glyph is wrapped by `MetaText`, so the text colour around it cannot
  // reach it - a card's subtitle, a hero's facts line and a title's own page all draw it the same
  // way - and nothing else is tinted with that gold: a favorite heart, a button's state and a focus
  // ring keep the colours they had. There is no outlined star to keep distinct: the app draws one
  // filled star beside the rating, and the rating's own value is the text beside it.
  const meta = readFileSync("src/components/Meta.tsx", "utf8")
  const cards = readFileSync("src/components/Cards.tsx", "utf8")
  const hero = readFileSync("src/components/Hero.tsx", "utf8")
  const itemPage = readFileSync("src/pages/Item.tsx", "utf8")
  check("the star is drawn from one token, and that token is gold", css.includes("--star: #ffd54a;"), "styles.css")
  check("and the star's class is that token and nothing else", /\.star\s*\{\s*color:\s*var\(--star\);\s*\}/.test(css), "styles.css")
  check(
    "nothing but a star is drawn in the star colour",
    (css.match(/var\(--star\)/g) || []).length === 1,
    `${(css.match(/var\(--star\)/g) || []).length} uses`,
  )
  check(
    "every rating goes through the one star renderer",
    cards.includes("MetaText text={subtitle}") &&
      hero.includes("<MetaLine item={item}") &&
      (itemPage.match(/<MetaLine item=\{/g) || []).length >= 2 &&
      itemPage.includes("MetaText text={facts}") &&
      meta.includes("export function MetaLine(") &&
      meta.includes("<MetaText text={text} />"),
    "Meta.tsx, Cards.tsx, Hero.tsx and Item.tsx",
  )
  check(
    "the star is one filled glyph, hidden from a screen reader, with the rating's text untouched",
    meta.includes('STAR = "★"') && meta.includes('aria-hidden="true"') && !/☆/.test(meta),
    "Meta.tsx",
  )
  check(
    "and no screen states a star colour of its own",
    !/\.star\s*\{[^}]*#[0-9a-f]{3,8}/i.test(css) && !/star[^\n]*color/i.test(cards) && !/star[^\n]*color/i.test(hero),
    "styles.css, Cards.tsx and Hero.tsx",
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
testLibraryToolbar()
testLibraryToolbarShapes()
testFavoritesWalk()
testPlayerPopup()
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

