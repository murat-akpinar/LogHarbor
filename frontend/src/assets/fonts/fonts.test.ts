import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The webfonts were 2.4 MB — 81% of a cold load, four times the rest of the app —
 * because the upstream files are Nerd Fonts carrying thousands of icon glyphs the
 * UI never draws. scripts/subset-fonts.py cuts them to 29 KB each, and the full
 * originals stay on disk next to the subsets as the source to re-cut from.
 *
 * That leaves one cheap way to lose the win by accident: point @font-face back at
 * a neighbouring original. Nothing else would look wrong — the app would render
 * identically and just cost 2.3 MB again. Hence a test, not a comment.
 */
const here = fileURLToPath(new URL('.', import.meta.url))
const css = readFileSync(`${here}fonts.css`, 'utf-8')
const referenced = [...css.matchAll(/url\("\.\/([^"]+)"\)/g)].map((m) => m[1])

/** Room for another weight or a widened range, far below the 1.2 MB originals. */
const BUDGET_BYTES = 64 * 1024

describe('shipped webfonts', () => {
  it('loads a font for every @font-face', () => {
    expect(referenced.length).toBeGreaterThan(0)
  })

  it.each(referenced)('%s is the subset, not the upstream file', (file) => {
    expect(file).toMatch(/-Subset\.woff2$/)
  })

  it.each(referenced)('%s stays within the size budget', (file) => {
    expect(statSync(`${here}${file}`).size).toBeLessThan(BUDGET_BYTES)
  })
})
