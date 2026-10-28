import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PortalApp } from './PortalApp';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// Detect public client portal route (/portal/:token)
const pathname = window.location.pathname;
const isPortalRoute = pathname.startsWith('/portal/');
const portalToken = isPortalRoute ? pathname.replace(/^\/portal\/?/, '').split('/')[0] : null;

createRoot(rootElement).render(
  <React.StrictMode>
    {isPortalRoute && portalToken ? <PortalApp token={portalToken} /> : <App />}
  </React.StrictMode>
);

// Register PWA Service Worker for offline resilience & fast caching
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[PocketCRM PWA] Service Worker registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.warn('[PocketCRM PWA] Service Worker registration failed:', err);
      });
  });
}
