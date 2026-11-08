import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'

import App from './App'
import { Toaster } from './components/ui/sonner'
import { applySystemTheme } from './lib/theme'
import './index.css'

applySystemTheme()

const root = document.getElementById('root')
if (!root) throw new Error('missing #root element')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Toaster position="bottom-right" />
    </BrowserRouter>
  </StrictMode>
)
