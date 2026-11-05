import {Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import CabinetFab from './cabinet/CabinetFab.tsx';
import './index.css';

const Cabinet = lazy(() => import('./cabinet/Cabinet.tsx'));
const isCabinet = window.location.pathname.startsWith('/app');

createRoot(document.getElementById('root')!).render(
  <>
    {isCabinet ? (
      <Suspense fallback={null}>
        <Cabinet />
      </Suspense>
    ) : (
      <>
        <App />
        <CabinetFab />
      </>
    )}
  </>,
);
