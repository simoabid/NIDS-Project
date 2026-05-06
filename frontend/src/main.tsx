import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Global toast notifications — used by alert:new socket event */}
    <Toaster
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        duration: 6000,
        style: {
          background: '#1e293b',
          border: '1px solid #334155',
          color: '#f1f5f9',
        },
      }}
    />
  </StrictMode>,
)
