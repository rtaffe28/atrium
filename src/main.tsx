import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { createHost } from './host/create';

// The host is resolved before the first render: under Electron it has to ask
// the main process which platform and window insets it is dealing with, and
// rendering the title bar twice to find out would flash the wrong chrome.
//
// A failure here used to leave a blank window, because a rejected promise
// meant render() simply never ran. Now it fails loudly.
const root = createRoot(document.getElementById('root')!);

createHost()
  .then((host) => {
    root.render(
      <StrictMode>
        <App host={host} />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error('[atrium] host failed to initialise', error);
    root.render(
      <pre style={{ padding: 24, color: '#f7768e', whiteSpace: 'pre-wrap' }}>
        {`Host failed to initialise\n\n${String(error)}\n\n${
          error instanceof Error ? error.stack : ''
        }`}
      </pre>,
    );
  });
