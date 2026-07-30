// @vitest-environment jsdom
import { afterEach, expect, it, describe, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SettingsTabs } from './SettingsTabs'

afterEach(cleanup)

const TABS = [
  { id: 'server', label: 'Server' },
  { id: 'storage', label: 'Storage' },
]

describe('SettingsTabs', () => {
  it('marks the open tab as selected and leaves the others alone', () => {
    render(<SettingsTabs tabs={TABS} active="storage" onChange={() => {}} />)

    expect(screen.getByRole('tab', { name: 'Storage' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Server' }).getAttribute('aria-selected')).toBe('false')
  })

  it('names the panel each tab controls, so the two are wired for a screen reader', () => {
    render(<SettingsTabs tabs={TABS} active="server" onChange={() => {}} />)

    const tab = screen.getByRole('tab', { name: 'Server' })
    expect(tab.getAttribute('aria-controls')).toBe('settings-panel-server')
    expect(tab.id).toBe('settings-tab-server')
  })

  it('reports the tab that was clicked', () => {
    const onChange = vi.fn()
    render(<SettingsTabs tabs={TABS} active="server" onChange={onChange} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Storage' }))

    expect(onChange).toHaveBeenCalledWith('storage')
  })

  // a viewer never gets the access tab, so the list it is handed is the whole of what it draws
  it('draws exactly the tabs it is given', () => {
    render(<SettingsTabs tabs={TABS} active="server" onChange={() => {}} />)

    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })
})
