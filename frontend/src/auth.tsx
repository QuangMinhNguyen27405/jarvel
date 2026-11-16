import type { FrontendConfig } from '@jarvel/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { fetchDemoAccount } from './api.js';
import { BrandMark, PlaneIcon, PostageStamp, SkylineArt } from './icons.js';

export interface Session {
  label: string;
  getToken: () => Promise<string>;
  signOut: () => void;
}

export type SignInComponent = (props: { children: (session: Session) => ReactNode }) => ReactNode;

const STORAGE_KEY = 'jarvel.devUser';
const MAX_NAME_LENGTH = 80;

/**
 * A local sign-in name as the dev API accepts it: letters, digits and . _ @ + - (so an email address works), at
 * most 80 characters. Anything else is dropped. Empty when nothing usable is left.
 */
export function cleanSignInName(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9._@+-]/g, '')
    .slice(0, MAX_NAME_LENGTH);
}

/**
 * Local development sign-in: any name or email address works; the dev API treats `dev-<name>` as that user. With
 * `apiUrl`, the page also asks that local server for its demo account and, when it has one, offers it as a button.
 * The demo account's address comes from the local server only; it is not written anywhere in the web app.
 */
export function createDevSignIn(apiUrl?: string, fetchFn?: typeof fetch): SignInComponent {
  return function DevSignIn({ children }) {
    const [name, setName] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');
    const [draft, setDraft] = useState('');
    const [demoUser, setDemoUser] = useState<string>();
    const signedOut = !name;
    useEffect(() => {
      if (apiUrl === undefined || !signedOut) return;
      let stopped = false;
      void fetchDemoAccount(apiUrl, fetchFn).then((account) => {
        if (stopped) return;
        // Offered only when signing in with it reaches exactly that account.
        setDemoUser(account && cleanSignInName(account.user) === account.user ? account.user : undefined);
      });
      return () => {
        stopped = true;
      };
    }, [signedOut]);
    /** The one sign-in path: the name field and the demo button both go through it. */
    const signIn = (raw: string) => {
      const clean = cleanSignInName(raw);
      if (!clean) return;
      localStorage.setItem(STORAGE_KEY, clean);
      setName(clean);
    };
    if (signedOut) {
      return (
        <div className="paper-page">
          <div className="airmail" aria-hidden="true" />
          <main className="signin">
            <div className="postcard">
              <div className="postcard-art" aria-hidden="true">
                <SkylineArt className="postcard-skyline" />
                <p className="postcard-greeting">
                  <span className="postcard-from">Greetings from</span>
                  <span className="postcard-city">Boston</span>
                </p>
              </div>
              <section className="postcard-body" aria-labelledby="signin-title">
                <div className="signin-head">
                  <div className="signin-head-text">
                    <span className="tag">Local mode</span>
                    <h1 id="signin-title" className="signin-title">
                      Sign in
                    </h1>
                  </div>
                  <PostageStamp className="signin-stamp" />
                </div>
                <p className="signin-tagline">Your Boston trip, planned day by day.</p>
                <form
                  className="signin-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    signIn(draft);
                  }}
                >
                  <label className="field">
                    <span className="field-label">Name or email</span>
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      maxLength={MAX_NAME_LENGTH}
                      autoComplete="off"
                      placeholder="Any name works"
                      data-testid="sign-in-name"
                      autoFocus
                    />
                  </label>
                  <button type="submit" className="btn btn-primary btn-wide" data-testid="sign-in">
                    Sign in
                    <PlaneIcon heading={90} />
                  </button>
                </form>
                {demoUser && (
                  <>
                    <div className="or" aria-hidden="true">
                      or
                    </div>
                    <div className="signin-demo">
                      <button
                        type="button"
                        className="btn btn-outline btn-wide"
                        data-testid="demo-sign-in"
                        onClick={() => signIn(demoUser)}
                      >
                        Use the demo account
                      </button>
                      <p className="signin-demo-note">{demoUser}, with one trip ready</p>
                    </div>
                  </>
                )}
              </section>
            </div>
          </main>
        </div>
      );
    }
    return children({
      label: name,
      getToken: async () => `dev-${name}`,
      signOut: () => {
        localStorage.removeItem(STORAGE_KEY);
        setName('');
      },
    });
  };
}

/** The local sign-in without a demo account: a name field only. */
export const DevSignIn: SignInComponent = createDevSignIn();

/** Real sign-in through the Cognito user pool (invite-only, so there is no sign-up form). */
export async function loadCognitoSignIn(config: FrontendConfig): Promise<SignInComponent> {
  const [{ Amplify }, { fetchAuthSession }, { Authenticator }] = await Promise.all([
    import('aws-amplify'),
    import('aws-amplify/auth'),
    import('@aws-amplify/ui-react'),
  ]);
  await import('@aws-amplify/ui-react/styles.css');
  Amplify.configure({
    Auth: { Cognito: { userPoolId: config.userPoolId, userPoolClientId: config.userPoolClientId } },
  });
  // The sign-in screen sits on the same paper page as the rest of the app, with the brand mark above the form.
  // Once signed in, the Authenticator renders only the app, and the wrapper adds nothing (see styles.css).
  const components = {
    Header: () => (
      <div className="cognito-brand">
        <BrandMark />
      </div>
    ),
  };
  return ({ children }) => (
    <div className="cognito-page">
      <Authenticator hideSignUp components={components}>
        {({ signOut, user }) => (
          <>
            {children({
            label: user?.signInDetails?.loginId ?? user?.username ?? 'you',
            getToken: async () => {
              const session = await fetchAuthSession();
              const token = session.tokens?.accessToken?.toString();
              if (!token) throw new Error('Your session has expired. Please sign in again.');
              return token;
            },
            signOut: () => signOut?.(),
          })}
          </>
        )
        }
      </Authenticator>
    </div>
  );
}
