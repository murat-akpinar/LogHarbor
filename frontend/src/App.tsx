import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { LoginGate } from './components/LoginGate'
import { NavBar } from './components/NavBar'
import { EventsPage } from './pages/EventsPage'
import { RequestsPage } from './pages/RequestsPage'
import { ExceptionsPage } from './pages/ExceptionsPage'
import { QueriesPage } from './pages/QueriesPage'
import { DashboardPage } from './pages/DashboardPage'
import { ServicesPage } from './pages/ServicesPage'
import { UsersPage } from './pages/UsersPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { SignalsPage } from './pages/SignalsPage'
import { AlertsPage } from './pages/AlertsPage'
import { SettingsPage } from './pages/SettingsPage'
import { SendLogsPage } from './pages/SendLogsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { LanguageProvider } from './i18n'

// The rolling window moves in 10s steps (useLiveRange's REFRESH_MS) and the window is part of
// every query key, so live data still arrives on its own. Without a staleTime to match, React
// Query's default of 0 refetched all twelve dashboard queries on every visit to a page the
// reader had been on seconds earlier — work the answer to which had not changed yet.
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 10_000 } },
  })
}

function App() {
  // one cache per mounted app rather than one per module: in the browser that is the same single
  // client, since App is mounted once, but it stops a suite that mounts App repeatedly from
  // inheriting the previous test's answers now that those answers are allowed to be reused
  const [queryClient] = useState(makeQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <BrowserRouter>
          <LoginGate>
            <div className="flex h-screen flex-col text-fg">
              <NavBar />
              <main className="min-h-0 flex-1">
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/events" element={<EventsPage />} />
                  <Route path="/requests" element={<RequestsPage />} />
                  <Route path="/exceptions" element={<ExceptionsPage />} />
                  <Route path="/queries" element={<QueriesPage />} />
                  <Route path="/services" element={<ServicesPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/analysis" element={<AnalysisPage />} />
                  <Route path="/signals" element={<SignalsPage />} />
                  <Route path="/alerts" element={<AlertsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/send" element={<SendLogsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </main>
            </div>
          </LoginGate>
        </BrowserRouter>
      </LanguageProvider>
    </QueryClientProvider>
  )
}

export default App
