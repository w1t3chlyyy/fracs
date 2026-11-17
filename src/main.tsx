import {Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import CabinetFab from './cabinet/CabinetFab.tsx';
import './index.css';

const Cabinet = lazy(() => import('./cabinet/Cabinet.tsx'));
const Offer = lazy(() => import('./Offer.tsx'));
const pathname = window.location.pathname;
const isCabinet = pathname.startsWith('/app');
const isOffer = pathname.startsWith('/offer');

createRoot(document.getElementById('root')!).render(
  <>
    {isCabinet ? (
      <Suspense fallback={null}>
        <Cabinet />
      </Suspense>
    ) : isOffer ? (
      <Suspense fallback={null}>
        <Offer />
      </Suspense>
    ) : (
      <>
        <App />
        <CabinetFab />
      </>
    )}
  </>,
);
