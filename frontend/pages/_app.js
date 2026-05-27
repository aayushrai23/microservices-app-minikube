import '../styles/globals.css';
import { Toaster } from 'react-hot-toast';
export default function App({ Component, pageProps }) {
  return (
    <>
      <Toaster position="top-right" toastOptions={{ style: { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' } }} />
      <Component {...pageProps} />
    </>
  );
}
