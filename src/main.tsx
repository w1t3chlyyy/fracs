import {Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const Cabinet = lazy(() => import('./cabinet/Cabinet.tsx'));
const Offer = lazy(() => import('./Offer.tsx'));
const Privacy = lazy(() => import('./Privacy.tsx'));
const Terms = lazy(() => import('./Terms.tsx'));
const pathname = window.location.pathname;
const isCabinet = pathname.startsWith('/app');
const isOffer = pathname.startsWith('/offer');
const isPrivacy = pathname.startsWith('/privacy');
const isTerms = pathname.startsWith('/terms');

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
    ) : isPrivacy ? (
      <Suspense fallback={null}>
        <Privacy />
      </Suspense>
    ) : isTerms ? (
      <Suspense fallback={null}>
        <Terms />
      </Suspense>
    ) : (
      <App />
    )}
  </>,
);
