import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';

import { AuthProvider } from './auth/AuthContext';
import { AppErrorBoundary } from './components/errors/AppErrorBoundary';
import { AppRouter } from './routes/AppRouter';
import './tailwind.css';
import './styles.css';
import 'sonner/dist/styles.css';

const RoutedApp = () => {
  const location = useLocation();

  return (
    <AppErrorBoundary resetKey={`${location.pathname}${location.search}`}>
      <AuthProvider>
        <AppRouter />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </AppErrorBoundary>
  );
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <RoutedApp />
    </BrowserRouter>
  </React.StrictMode>,
);
