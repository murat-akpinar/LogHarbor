import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'

/** Catch-all for unknown client routes; the server already serves index.html for them. */
export function NotFoundPage() {
  const { t } = useI18n()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
      <h1 className="text-lg font-semibold text-fg">{t.notFound.title}</h1>
      <Link to="/" className="text-sm text-accent hover:underline">
        {t.notFound.backToEvents}
      </Link>
    </div>
  )
}
