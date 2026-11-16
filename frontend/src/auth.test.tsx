import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDemoAccount } from './api.js';
import { cleanSignInName, createDevSignIn, DevSignIn, type Session, type SignInComponent } from './auth.js';

// A made-up address: the real demo address lives only in the local server (backend/scripts/demo.ts).
const DEMO = 'demo.user+trip@example.com';
const API = 'http://localhost:8787';
const STORAGE_KEY = 'jarvel.devUser';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A stand-in for the local server: answers every request with `answer` as JSON. */
function serverAnswering(answer: unknown, status = 200) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

/** Renders a sign-in component around a page that shows who is signed in. Returns the sessions it was given. */
function renderSignIn(SignIn: SignInComponent): Session[] {
  const sessions: Session[] = [];
  render(
    <SignIn>
      {(session) => {
        sessions.push(session);
        return (
          <div>
            <p data-testid="who">{session.label}</p>
            <button onClick={session.signOut}>Sign out</button>
          </div>
        );
      }}
    </SignIn>,
  );
  return sessions;
}

/** Lets the page finish asking the local server and draw the answer. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

describe('local sign-in: the demo account (Step 15)', () => {
  it('offers "Use the demo account" when the local server has one, and signs in as it', async () => {
    const fetchFn = serverAnswering({ user: DEMO, planId: '00000000-0000-4000-8000-000000000001' });
    const sessions = renderSignIn(createDevSignIn(API, fetchFn));
    const button = await screen.findByTestId('demo-sign-in');
    expect(button).toHaveTextContent('Use the demo account');
    expect(fetchFn.mock.calls[0]![0]).toBe(`${API}/dev/demo`);
    expect(screen.getByText(`${DEMO}, with one trip ready`)).toBeInTheDocument();
    expect(screen.queryByTestId('who')).not.toBeInTheDocument(); // nobody is signed in before the click

    fireEvent.click(button);
    expect(screen.getByTestId('who')).toHaveTextContent(DEMO);
    expect(await sessions.at(-1)!.getToken()).toBe(`dev-${DEMO}`);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(DEMO);
    expect(screen.queryByTestId('demo-sign-in')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sign-in-name')).not.toBeInTheDocument();
  });

  it('shows no button when the local server has no demo account', async () => {
    const fetchFn = serverAnswering({ user: null, planId: null });
    renderSignIn(createDevSignIn(API, fetchFn));
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await settle();
    expect(screen.queryByTestId('demo-sign-in')).not.toBeInTheDocument();
    expect(screen.getByTestId('sign-in-name')).toBeInTheDocument(); // the page is the plain name form
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows no button, and no error, when the local server cannot be reached', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const sessions = renderSignIn(createDevSignIn(API, fetchFn));
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await settle();
    expect(screen.queryByTestId('demo-sign-in')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();

    // The name form still works: the page is as it was before the demo account existed.
    fireEvent.change(screen.getByTestId('sign-in-name'), { target: { value: 'amy' } });
    fireEvent.click(screen.getByTestId('sign-in'));
    expect(screen.getByTestId('who')).toHaveTextContent('amy');
    expect(await sessions.at(-1)!.getToken()).toBe('dev-amy');
  });

  it('shows no button for an answer it cannot use', async () => {
    const answers: [unknown, number][] = [
      [{ error: 'No such route.', code: 'route-not-found' }, 404],
      ['<html>not json</html>', 200],
      [{ user: 'someone else@example.com', planId: null }, 200], // a name the sign-in would have to change
      [{ user: '', planId: null }, 200],
      [{ user: 42 }, 200],
      [null, 200],
    ];
    for (const [answer, status] of answers) {
      const fetchFn = serverAnswering(answer, status);
      renderSignIn(createDevSignIn(API, fetchFn));
      await waitFor(() => expect(fetchFn).toHaveBeenCalled());
      await settle();
      expect(screen.queryByTestId('demo-sign-in'), JSON.stringify(answer)).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('signs in with a typed email address', async () => {
    const sessions = renderSignIn(createDevSignIn(API, serverAnswering({ user: null, planId: null })));
    fireEvent.change(screen.getByLabelText('Name or email'), { target: { value: '  amy.smith+boston@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByTestId('who')).toHaveTextContent('amy.smith+boston@example.com');
    expect(await sessions.at(-1)!.getToken()).toBe('dev-amy.smith+boston@example.com');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('amy.smith+boston@example.com');
  });

  it('keeps only the characters the local server accepts, and does not sign in with nothing left', async () => {
    expect(cleanSignInName(' Amy Smith <amy@example.com> ')).toBe('AmySmithamy@example.com');
    expect(cleanSignInName('a.b_c+d-e@x.org')).toBe('a.b_c+d-e@x.org');
    expect(cleanSignInName('né/e:o#1%40')).toBe('neo140');
    expect(cleanSignInName('x'.repeat(100))).toBe('x'.repeat(80));
    expect(cleanSignInName('   ')).toBe('');

    renderSignIn(DevSignIn);
    fireEvent.change(screen.getByTestId('sign-in-name'), { target: { value: ' !!! ' } });
    fireEvent.click(screen.getByTestId('sign-in'));
    expect(screen.queryByTestId('who')).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('sign-in-name')).toHaveAttribute('maxlength', '80');
  });

  it('offers the demo account again after signing out', async () => {
    const fetchFn = serverAnswering({ user: DEMO, planId: null });
    renderSignIn(createDevSignIn(API, fetchFn));
    fireEvent.click(await screen.findByTestId('demo-sign-in'));
    expect(screen.getByTestId('who')).toHaveTextContent(DEMO);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.queryByTestId('who')).not.toBeInTheDocument();
    expect(await screen.findByTestId('demo-sign-in')).toBeInTheDocument();
    expect(screen.getByTestId('sign-in-name')).toBeInTheDocument();
  });

  it('stays signed in after a reload, without asking for the demo account', async () => {
    localStorage.setItem(STORAGE_KEY, 'amy@example.com');
    const fetchFn = serverAnswering({ user: DEMO, planId: null });
    const sessions = renderSignIn(createDevSignIn(API, fetchFn));
    expect(screen.getByTestId('who')).toHaveTextContent('amy@example.com');
    expect(await sessions.at(-1)!.getToken()).toBe('dev-amy@example.com');
    await settle();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never asks for a demo account when it was given no API address', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    renderSignIn(DevSignIn);
    await settle();
    expect(globalFetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('demo-sign-in')).not.toBeInTheDocument();
    expect(screen.getByTestId('sign-in-name')).toBeInTheDocument();
  });
});

describe('fetchDemoAccount', () => {
  it('asks GET /dev/demo of the API address and returns the account and its trip', async () => {
    const fetchFn = serverAnswering({ user: DEMO, planId: 'p-1' });
    expect(await fetchDemoAccount(API, fetchFn)).toEqual({ user: DEMO, planId: 'p-1' });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/dev/demo');
    expect(init?.method).toBeUndefined(); // a plain GET
    expect((init?.headers as Record<string, string>).authorization).toBeUndefined(); // and no sign-in
  });

  it('reports a trip that is not there yet as null', async () => {
    expect(await fetchDemoAccount(API, serverAnswering({ user: DEMO, planId: null }))).toEqual({
      user: DEMO,
      planId: null,
    });
    expect(await fetchDemoAccount(API, serverAnswering({ user: DEMO }))).toEqual({ user: DEMO, planId: null });
  });

  it('is null when there is no demo account, the answer is unusable or the server is down', async () => {
    expect(await fetchDemoAccount(API, serverAnswering({ user: null, planId: null }))).toBeNull();
    expect(await fetchDemoAccount(API, serverAnswering({ user: DEMO, planId: 'p-1' }, 500))).toBeNull();
    expect(await fetchDemoAccount(API, serverAnswering('not json'))).toBeNull();
    expect(await fetchDemoAccount(API, serverAnswering(null))).toBeNull();
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await fetchDemoAccount(API, down)).toBeNull();
  });
});
