import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { en } from './en'
import type { Messages } from './en'
import { tr } from './tr'

export type Lang = 'en' | 'tr'

const STORAGE_KEY = 'logharbor-lang'
const DICTIONARIES: Record<Lang, Messages> = { en, tr }

/** localStorage choice wins; otherwise a Turkish browser gets tr, everyone else en. */
export function detectLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'tr') return stored
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

interface I18nValue {
  lang: Lang
  t: Messages
  setLang: (lang: Lang) => void
}

const I18nContext = createContext<I18nValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  function setLang(next: Lang) {
    localStorage.setItem(STORAGE_KEY, next)
    setLangState(next)
  }

  return <I18nContext.Provider value={{ lang, t: DICTIONARIES[lang], setLang }}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside LanguageProvider')
  return value
}
