import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import '@fontsource-variable/inter'

import App from './App'
import { Toaster } from './components/ui/sonner'
import { startTheme } from './lib/theme'
import './index.css'

startTheme()

const root = document.getElementById('root')
if (!root) throw new Error('missing #root element')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
      <Toaster position="top-center" offset={{ top: 88 }} />
    </BrowserRouter>
  </StrictMode>
)
