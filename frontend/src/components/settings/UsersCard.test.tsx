// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { LanguageProvider } from '../../i18n'
import type { User } from '../../types'
import { UsersCard } from './UsersCard'

const users = vi.hoisted(() => ({ list: [] as User[] }))
const deleteUser = vi.hoisted(() => vi.fn())

vi.mock('../../hooks/useUsers', () => ({
  useUsers: () => ({ data: users.list, isLoading: false, error: null }),
  useCreateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteUser: () => ({ mutate: deleteUser, isPending: false, error: null }),
}))

const LOCAL: User = {
  id: 1,
  username: 'alice',
  role: 'admin',
  createdAt: '2026-07-01T09:00:00.0000000Z',
  lastLoginAt: '2026-08-01T13:24:00.0000000Z',
  source: 'local',
}
const NEVER: User = { ...LOCAL, id: 2, username: 'bob', role: 'viewer', lastLoginAt: null }
const DIRECTORY: User = {
  id: null,
  username: 'hermione',
  role: 'admin',
  createdAt: '2026-07-20T08:00:00.0000000Z',
  lastLoginAt: '2026-08-01T16:05:00.0000000Z',
  source: 'ldap',
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.resetAllMocks()
  users.list = []
})

function renderCard(list: User[]) {
  users.list = list
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <UsersCard />
    </LanguageProvider>,
  )
}

function rowOf(username: string): HTMLElement {
  return screen.getByText(username).closest('tr') as HTMLElement
}

// asked for 2026-08-01: directory users should land in this list once they have signed in,
// marked as directory sign-ins, with the date
it('marks a directory sign-in and shows when it happened', () => {
  renderCard([LOCAL, DIRECTORY])

  const row = rowOf('hermione')
  expect(within(row).getByText('LDAP')).toBeDefined()
  expect(row.textContent).toContain('8/1/2026')
  // and a local account is not labelled as one
  expect(within(rowOf('alice')).queryByText('LDAP')).toBeNull()
})

// the row records a sign-in; it grants nothing, so there is nothing here to revoke
it('offers Delete on local accounts only', () => {
  renderCard([LOCAL, DIRECTORY])

  expect(within(rowOf('alice')).getByRole('button', { name: 'Delete' })).toBeDefined()
  expect(within(rowOf('hermione')).queryByRole('button', { name: 'Delete' })).toBeNull()
})

// "has an account and has never used it" is a different answer from "signed in at some point"
it('says so when an account has never been signed in to', () => {
  renderCard([NEVER])

  expect(within(rowOf('bob')).getByText('never')).toBeDefined()
})
