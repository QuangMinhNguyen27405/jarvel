// Fonts are bundled with the app (no request to Google): Fraunces with its weight and optical-size axes, upright
// and italic; Inter (variable weight); IBM Plex Mono 500 and 600.
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource-variable/inter/index.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createDevSignIn, loadCognitoSignIn, type SignInComponent } from './auth.js';
import { loadConfig } from './config.js';
import { Alert, Loading } from './ui.js';
import './styles.css';

function Root() {
  const [state, setState] = useState<{ apiUrl: string; SignIn: SignInComponent } | { error: string } | undefined>();
  useEffect(() => {
    loadConfig()
      .then(async (config) => {
        // Local development: the sign-in page asks the local API at this address for its demo account.
        const SignIn = config.mock ? createDevSignIn(config.apiUrl) : await loadCognitoSignIn(config);
        setState({ apiUrl: config.apiUrl, SignIn });
      })
      .catch((error: Error) => setState({ error: error.message }));
  }, []);
  if (!state || 'error' in state) {
    return (
      <div className="paper-page">
        <div className="airmail" aria-hidden="true" />
        <main className="startup">{state ? <Alert>Could not start the app: {state.error}</Alert> : <Loading />}</main>
      </div>
    );
  }
  const { SignIn, apiUrl } = state;
  return <SignIn>{(session) => <App apiUrl={apiUrl} session={session} />}</SignIn>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
