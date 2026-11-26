import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { AppShell } from './AppShell'
import { HomePage, NotFoundPage } from './pages/HomePage'
import { AtlasPage } from './pages/AtlasPage'
import { NewBodyPage } from './pages/NewBodyPage'
import { MapEditorPage } from './pages/MapEditor'
import './index.css'
import './shell.css'

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'atlas', element: <AtlasPage /> },
      { path: 'atlas/novo', element: <NewBodyPage /> },
      { path: 'atlas/:bodyId', element: <MapEditorPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
