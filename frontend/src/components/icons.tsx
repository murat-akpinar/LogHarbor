import type { ReactNode } from 'react'

export type PageIconName =
  | 'dashboard'
  | 'events'
  | 'requests'
  | 'exceptions'
  | 'queries'
  | 'services'
  | 'users'
  | 'analysis'
  | 'signals'
  | 'alerts'
  | 'settings'

// hand-rolled lucide-style outlines; 24 viewBox, stroke inherits text color
const PATHS: Record<PageIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  events: <path d="M4 6h16M4 12h16M4 18h10" />,
  requests: <path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" />,
  exceptions: <path d="M12 3 2 21h20L12 3zM12 10v5M12 18.5v.01" />,
  queries: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  services: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.4c2.1.8 3.5 2.9 3.5 5.6" />
    </>
  ),
  analysis: <path d="M5 21v-8M12 21V4M19 21v-6" />,
  signals: <path d="M6 3h12v18l-6-4.5L6 21V3z" />,
  alerts: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="7" cy="17" r="2" />
    </>
  ),
}

/**
 * The affordance on a figure that has an explanation behind it. Deliberately not in PageIconName:
 * that type is nav destinations, and this is a control.
 */
export function InfoIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </svg>
  )
}

/** Small line icon for a nav destination; decorative (aria-hidden), colored by the text around it. */
export function PageIcon({ name, className = 'size-4' }: { name: PageIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
