// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider, detectLang, useI18n } from './index'
import { en } from './en'
import { tr } from './tr'

function Probe() {
  const { lang, t, setLang } = useI18n()
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="loading">{t.common.loading}</span>
      <button onClick={() => setLang(lang === 'en' ? 'tr' : 'en')}>switch</button>
    </div>
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('detectLang', () => {
  it('prefers a valid stored language over the browser language', () => {
    localStorage.setItem('logharbor-lang', 'tr')
    vi.stubGlobal('navigator', { ...navigator, language: 'en-US' })
    expect(detectLang()).toBe('tr')
  })

  it('falls back to the browser language when nothing is stored', () => {
    vi.stubGlobal('navigator', { ...navigator, language: 'tr-TR' })
    expect(detectLang()).toBe('tr')
  })

  it('ignores an invalid stored value and defaults to en for non-Turkish browsers', () => {
    localStorage.setItem('logharbor-lang', 'de')
    vi.stubGlobal('navigator', { ...navigator, language: 'de-DE' })
    expect(detectLang()).toBe('en')
  })
})

describe('LanguageProvider', () => {
  it('setLang persists the choice, updates <html lang>, and swaps the dictionary', async () => {
    vi.stubGlobal('navigator', { ...navigator, language: 'en-US' })
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    )
    expect(screen.getByTestId('loading').textContent).toBe(en.common.loading)

    screen.getByText('switch').click()
    expect((await screen.findByTestId('loading')).textContent).toBe(tr.common.loading)
    expect(localStorage.getItem('logharbor-lang')).toBe('tr')
    expect(document.documentElement.lang).toBe('tr')
  })
})

describe('dictionary parity', () => {
  it('tr has no empty strings anywhere', () => {
    function assertNoEmpty(node: unknown, path: string) {
      if (typeof node === 'string') {
        expect(node.length, `empty translation at ${path}`).toBeGreaterThan(0)
      } else if (Array.isArray(node)) {
        node.forEach((item, index) => assertNoEmpty(item, `${path}[${index}]`))
      } else if (typeof node === 'object' && node !== null) {
        for (const [key, value] of Object.entries(node)) assertNoEmpty(value, `${path}.${key}`)
      }
      // functions are exercised by the components that call them; skip here
    }
    assertNoEmpty(tr, 'tr')
  })
})
