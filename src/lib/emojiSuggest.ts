/**
 * emoji auto-suggest for the event title.
 *
 * pure client-side keyword matching: instant, offline, free. the whole index
 * is precomputed once at module load from EMOJI_KEYWORDS, so suggestEmojis is
 * a handful of Map lookups per keystroke (well under a millisecond).
 *
 * CONTRACT
 * `suggestEmojis(title)` returns a ranked, deduped list of at most 6 emoji,
 * or [] when the title has no signal. **The first element is the auto-select
 * candidate.**
 *
 * intended composer behavior:
 * - on every title keystroke, call suggestEmojis and show the results as a
 *   small emoji row. auto-select suggestions[0] live as the user types, so a
 *   creator who types "pizza night?" and never touches the row still gets 🍕.
 * - the user can tap any other suggestion to pin it, or tap the selected one
 *   to deselect. once the user has pinned or deselected manually, stop
 *   auto-selecting for this compose session (their choice wins over ours).
 * - an empty result should clear an auto-selected emoji but never a pinned one.
 *
 * future async source (LLM, server-side, whatever): keep this sync path as the
 * instant first paint, then when the async source resolves, merge its picks in
 * with mergeSuggestions(asyncPicks, syncPicks) and re-render. the auto-select
 * rule stays the same: first element wins unless the user already pinned.
 *
 * RANKING
 * - phrase matches ("happy hour", "road trip") beat single-token matches.
 * - exact token matches beat prefix matches. prefixes need >= 3 typed chars,
 *   so "pizz" already suggests 🍕 mid-word.
 * - within the same strength, the match that starts earlier in the title wins;
 *   later tokens never beat an earlier match of equal or greater strength.
 * - remaining ties break by curated order in EMOJI_KEYWORDS. fully stable:
 *   same title always returns the same list.
 */
import { EMOJI_KEYWORDS } from './emojiKeywords'

/** shape of a future async suggestion source, layered on top of the sync one */
export type AsyncEmojiSource = (title: string) => Promise<string[]>

const MAX_SUGGESTIONS = 6
const MIN_PREFIX_LEN = 3
const MIN_TOKEN_LEN = 2

/** score tiers; gaps stay larger than any realistic position penalty */
const SCORE_PHRASE = 300
const SCORE_PHRASE_PARTIAL = 260
const SCORE_EXACT = 200
const SCORE_PREFIX = 100
const MAX_POSITION_PENALTY = 50

/**
 * words that are never treated as prefix queries: too common in titles and
 * they collide with real keywords ("the" -> theater, "wed" -> wedding,
 * "fri" -> fries, "can" -> canoe, "sun" -> sunset, "night" -> nightcap)
 */
const PREFIX_STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'with', 'lets', 'let', 'our', 'are', 'this',
  'that', 'out', 'not', 'but', 'all', 'can', 'get', 'gonna', 'wanna', 'night',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
])

interface IndexEntry {
  emoji: string
  /** position in EMOJI_KEYWORDS; the stable tiebreak */
  order: number
}

interface PhraseEntry extends IndexEntry {
  /** phrase words after the first, e.g. ['hour'] for 'happy hour' */
  rest: readonly string[]
}

// ---- precomputed index, built once at module load ----

const exactIndex = new Map<string, IndexEntry[]>()
const prefixIndex = new Map<string, IndexEntry[]>()
/** phrases bucketed by first word */
const phraseIndex = new Map<string, PhraseEntry[]>()

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

for (let order = 0; order < EMOJI_KEYWORDS.length; order++) {
  const [emoji, keywords] = EMOJI_KEYWORDS[order]
  for (const keyword of keywords) {
    const words = keyword.split(' ')
    if (words.length > 1) {
      push(phraseIndex, words[0], { emoji, order, rest: words.slice(1) })
      continue
    }
    push(exactIndex, keyword, { emoji, order })
    // index every proper prefix of length >= 3 so partial typing matches
    for (let len = MIN_PREFIX_LEN; len < keyword.length; len++) {
      push(prefixIndex, keyword.slice(0, len), { emoji, order })
    }
  }
}

// ---- tokenizer ----

function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/d&d/g, 'dnd')
    .replace(/['’`]s(?![a-z0-9])/g, '') // sarah's -> sarah
    .replace(/['’`]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

// ---- matcher ----

interface Hit {
  score: number
  order: number
}

function bump(hits: Map<string, Hit>, emoji: string, score: number, order: number): void {
  const prev = hits.get(emoji)
  if (!prev || score > prev.score || (score === prev.score && order < prev.order)) {
    hits.set(emoji, { score, order })
  }
}

/** exact-word and phrase matches clear this; prefix guesses do not */
const CONFIDENT_MIN = SCORE_EXACT - MAX_POSITION_PENALTY

function computeHits(title: string): Map<string, Hit> {
  const tokens = tokenize(title)
  const hits = new Map<string, Hit>()
  if (tokens.length === 0) return hits

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const penalty = Math.min(i, MAX_POSITION_PENALTY)

    // phrase matches starting at this token
    const phrases = phraseIndex.get(token)
    if (phrases) {
      for (const phrase of phrases) {
        const match = matchPhraseRest(tokens, i + 1, phrase.rest)
        if (match === 'full') bump(hits, phrase.emoji, SCORE_PHRASE - penalty, phrase.order)
        else if (match === 'partial') bump(hits, phrase.emoji, SCORE_PHRASE_PARTIAL - penalty, phrase.order)
      }
    }

    if (token.length < MIN_TOKEN_LEN) continue

    // exact single-word keyword, with a cheap plural fallback (pizzas -> pizza)
    const exact = exactIndex.get(token) ?? (token.endsWith('s') ? exactIndex.get(token.slice(0, -1)) : undefined)
    if (exact) {
      for (const entry of exact) bump(hits, entry.emoji, SCORE_EXACT - penalty, entry.order)
    }

    // the typed token is a >= 3 char prefix of a keyword ("pizz" -> pizza)
    if (token.length >= MIN_PREFIX_LEN && !PREFIX_STOPWORDS.has(token)) {
      const prefixed = prefixIndex.get(token)
      if (prefixed) {
        for (const entry of prefixed) bump(hits, entry.emoji, SCORE_PREFIX - penalty, entry.order)
      }
    }
  }
  return hits
}

/**
 * ranked emoji suggestions for an event title. deduped, max 6, [] when the
 * title has no signal. pure and synchronous; safe on every keystroke.
 */
export function suggestEmojis(title: string): string[] {
  return [...computeHits(title).entries()]
    .sort((a, b) => b[1].score - a[1].score || a[1].order - b[1].order || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_SUGGESTIONS)
    .map(([emoji]) => emoji)
}

/**
 * The single emoji to AUTO-select as the user types, or null. Only fires on a
 * CONFIDENT match (a full word or phrase, e.g. "jazz", "happy hour"), never on
 * a mid-word prefix guess, so we do not flash a wrong emoji before we actually
 * know the plan. Once a keyword resolves, this returns it.
 */
export function suggestEmoji(title: string): string | null {
  let best: { emoji: string; score: number; order: number } | null = null
  for (const [emoji, h] of computeHits(title)) {
    if (h.score < CONFIDENT_MIN) continue
    if (!best || h.score > best.score || (h.score === best.score && h.order < best.order)) {
      best = { emoji, score: h.score, order: h.order }
    }
  }
  return best ? best.emoji : null
}

/**
 * does tokens[from..] continue the rest of a phrase? 'full' when every word
 * matches, 'partial' when everything matches except the title's final token,
 * which is a >= 3 char prefix of the phrase's last word (still being typed:
 * "happy hou" -> happy hour)
 */
function matchPhraseRest(tokens: string[], from: number, rest: readonly string[]): 'full' | 'partial' | null {
  for (let j = 0; j < rest.length; j++) {
    const token = tokens[from + j]
    if (token === undefined) return null
    if (token === rest[j]) continue
    const isLastPhraseWord = j === rest.length - 1
    const isLastTitleToken = from + j === tokens.length - 1
    if (
      isLastPhraseWord &&
      isLastTitleToken &&
      token.length >= MIN_PREFIX_LEN &&
      rest[j].startsWith(token)
    ) {
      return 'partial'
    }
    return null
  }
  return 'full'
}

/**
 * merge two suggestion lists (async picks first, sync picks as backfill) into
 * one deduped list capped at 6. exists so a future async source can layer on
 * top of the sync matcher without reimplementing the cap or dedup.
 */
export function mergeSuggestions(primary: string[], secondary: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const emoji of [...primary, ...secondary]) {
    if (seen.has(emoji)) continue
    seen.add(emoji)
    merged.push(emoji)
    if (merged.length === MAX_SUGGESTIONS) break
  }
  return merged
}
