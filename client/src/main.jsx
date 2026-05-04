import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

try {
  const theme = JSON.parse(localStorage.getItem('adsctrl-theme') || 'null')
  if (theme?.bg) document.documentElement.style.setProperty('--bg', theme.bg)
  if (theme?.primary) {
    document.documentElement.style.setProperty('--b', theme.primary)
    document.documentElement.style.setProperty('--g', theme.primary)
    document.documentElement.style.setProperty('--g2', theme.primary)
    document.documentElement.style.setProperty('--gradient-main', `linear-gradient(90deg, ${theme.primary} 0%, ${theme.primary} 100%)`)
    document.documentElement.style.setProperty('--gradient-blue', `linear-gradient(135deg, ${theme.primary} 0%, ${theme.primary} 100%)`)
  }
} catch {
  // Ignore invalid saved theme data.
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
