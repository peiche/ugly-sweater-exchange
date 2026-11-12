import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createExchange,
  deleteExchange,
  ensureAnonymousSession,
  findExchangeByCode,
  isConfigured,
  joinExchange,
  listParticipants,
  markViewed,
  myAssignment,
  removeParticipant,
  resetDraw,
  runDraw,
} from './appwrite';
import type { Assignment, Exchange, Participant } from './types';

function Snowfall() {
  const flakes = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        left: (i * 37.3 + 11) % 100,
        delay: -((i * 1.7) % 14),
        duration: 9 + ((i * 2.3) % 8),
        size: 6 + ((i * 3) % 10),
      })),
    [],
  );
  return (
    <div className="snowfall" aria-hidden="true">
      {flakes.map((f, i) => (
        <span
          key={i}
          className="flake"
          style={{
            left: `${f.left}%`,
            animationDelay: `${f.delay}s`,
            animationDuration: `${f.duration}s`,
            fontSize: f.size,
          }}
        >
          ❄
        </span>
      ))}
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        left: (i * 29.7 + 5) % 100,
        delay: -((i * 0.9) % 3),
        color: ['#c0392b', '#1e7d46', '#d4a017', '#f5f0e6', '#2e86ab'][i % 5],
        rotate: (i * 47) % 360,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, background: p.color }}
        />
      ))}
    </div>
  );
}

/** Read a join code from the current URL: /exchange/ABC123, or ?code=ABC123. */
function codeFromLocation(): string {
  const pathMatch = window.location.pathname.match(/^\/exchange\/([A-Za-z0-9]{1,6})/i);
  if (pathMatch) return pathMatch[1].toUpperCase();
  return new URLSearchParams(window.location.search).get('code')?.toUpperCase() ?? '';
}

export default function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myParticipant, setMyParticipant] = useState<Participant | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [assignmentChecked, setAssignmentChecked] = useState(false);
  // True while the app is still trying to reopen an exchange from the URL or
  // this device's remembered code — the home page stays hidden until then, so
  // a direct exchange link doesn't flash the home page first.
  const [restoring, setRestoring] = useState(
    () => Boolean(codeFromLocation() || window.localStorage.getItem('ugly-sweater-exchange-code')),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Join with a code from a shared link: /exchange/ABC123 (or the older ?code=ABC123)
  const [joinCode, setJoinCode] = useState(() => codeFromLocation());
  const [joinName, setJoinName] = useState('');
  const [createName, setCreateName] = useState('');
  const [organizerName, setOrganizerName] = useState('');
  const [spendingLimit, setSpendingLimit] = useState('');
  const [exchangeDate, setExchangeDate] = useState('');

  useEffect(() => {
    if (!isConfigured) return;
    ensureAnonymousSession()
      .then(setUserId)
      .catch(() => setSessionError('Could not start an anonymous session. Check your Appwrite setup and try again.'));
  }, []);

  // Reopen the exchange directly: an /exchange/CODE link goes straight to the
  // exchange page, and the last exchange code is remembered on this device so a
  // refresh (or coming back later) lands back on it instead of the home page.
  useEffect(() => {
    if (!isConfigured || !userId) return;
    const code = codeFromLocation() || window.localStorage.getItem('ugly-sweater-exchange-code') || '';
    if (!code) {
      setRestoring(false);
      return;
    }
    setJoinCode(code);
    findExchangeByCode(code)
      .then((ex) => {
        if (ex) {
          setExchange(ex);
        } else {
          // The link points at an exchange that no longer exists (deleted, or
          // a mistyped code): forget it and go back to the home page instead
          // of sitting on a dead /exchange/CODE URL.
          window.localStorage.removeItem('ugly-sweater-exchange-code');
          window.history.replaceState(null, '', '/');
          setNotice("That exchange doesn't exist anymore — it may have been deleted.");
        }
      })
      .catch(() => {})
      .finally(() => setRestoring(false));
  }, [userId]);

  // Keep the code in the URL and remembered on this device while viewing an exchange.
  useEffect(() => {
    if (!exchange) return;
    window.localStorage.setItem('ugly-sweater-exchange-code', exchange.joinCode);
    window.history.replaceState(null, '', `/exchange/${exchange.joinCode}`);
  }, [exchange]);

  function leaveExchange() {
    window.localStorage.removeItem('ugly-sweater-exchange-code');
    window.history.replaceState(null, '', '/');
    setExchange(null);
    setParticipants([]);
    setMyParticipant(null);
    setAssignment(null);
    setAssignmentChecked(false);
    setJoinCode('');
    clearMessages();
  }

  const refresh = useCallback(
    async (ex: Exchange, uid: string) => {
      const list = await listParticipants(ex.$id);
      setParticipants(list);
      const mine = list.find((p) => p.userId === uid) ?? null;
      setMyParticipant(mine);
      if (ex.drawn && mine) {
        const mineAssignment = await myAssignment(ex.$id, uid);
        setAssignment(mineAssignment);
      } else {
        setAssignment(null);
      }
      setAssignmentChecked(true);
    },
    [],
  );

  useEffect(() => {
    if (exchange && userId) {
      refresh(exchange, userId).catch(() => setError('Could not load the exchange. Try refreshing.'));
    }
  }, [exchange, userId, refresh]);

  const isOrganizer = exchange !== null && userId !== null && exchange.organizerUserId === userId;
  const shareUrl =
    exchange !== null
      ? `${window.location.origin}/exchange/${exchange.joinCode}`
      : '';

  function clearMessages() {
    setError('');
    setNotice('');
  }

  /** Accept a bare 6-char code OR a full invite link pasted into the join field. */
  function parseJoinCodeInput(raw: string): string {
    const trimmed = raw.trim();
    const urlMatch =
      trimmed.match(/[?&]code=([A-Za-z0-9]{1,6})/) ??
      trimmed.match(/\/exchange\/([A-Za-z0-9]{1,6})/i);
    if (urlMatch) return urlMatch[1].toUpperCase();
    return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    clearMessages();
    setBusy(true);
    try {
      const ex = await createExchange({
        name: createName.trim(),
        spendingLimit: spendingLimit.trim(),
        exchangeDate,
        organizerUserId: userId,
        organizerName: organizerName.trim(),
      });
      // The organizer joins their own exchange automatically.
      await joinExchange({ exchangeId: ex.$id, name: organizerName.trim(), userId });
      setExchange(ex);
      setNotice(`Exchange created! Share the join code ${ex.joinCode} with your family.`);
    } catch (err) {
      setError(`Could not create the exchange: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    clearMessages();
    setBusy(true);
    try {
      const ex = await findExchangeByCode(joinCode);
      if (!ex) throw new Error('No exchange found with that join code. Double-check the code and try again.');
      const existing = await listParticipants(ex.$id);
      const alreadyJoined = existing.find((p) => p.userId === userId);
      if (alreadyJoined) {
        setExchange(ex);
        setNotice(`This device already joined as ${alreadyJoined.name}. Each person joins from their own phone or browser — to join as someone else, open the invite link on their device.`);
        return;
      }
      if (ex.drawn) throw new Error('The names have already been drawn for this exchange, so new people cannot join.');
      if (existing.some((p) => p.name.toLowerCase() === joinName.trim().toLowerCase())) {
        throw new Error(`Someone named "${joinName.trim()}" already joined. Add a last initial so everyone can tell you apart.`);
      }
      await joinExchange({ exchangeId: ex.$id, name: joinName.trim(), userId });
      setExchange(ex);
      setNotice(`You're in, ${joinName.trim()}! You'll see your match here once the organizer draws names.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDraw() {
    if (!exchange || !isOrganizer) return;
    if (participants.length < 3) {
      setError('You need at least 3 people joined before you can draw names.');
      return;
    }
    if (!window.confirm(`Draw names for ${participants.length} people? Nobody — not even you — will be able to see who got whom, except each person seeing their own match.`)) return;
    clearMessages();
    setBusy(true);
    try {
      // runDraw computes the derangement, writes the per-person assignment
      // documents, and discards the mapping. Nothing is kept in this browser.
      await runDraw(exchange, participants);
      const updated = { ...exchange, drawn: true };
      setExchange(updated);
      await refresh(updated, userId!);
      setNotice('Names drawn! Everyone can now open the site on their own device to see who they got.');
    } catch (err) {
      setError(`Draw failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRedraw() {
    if (!exchange || !isOrganizer) return;
    if (!window.confirm('This deletes all the current assignments and draws fresh names. Everyone will need to check again for their new match. Continue?')) return;
    clearMessages();
    setBusy(true);
    try {
      await resetDraw(exchange.$id);
      const updated = { ...exchange, drawn: false };
      setExchange(updated);
      await refresh(updated, userId!);
      setNotice('Draw cleared. You can draw fresh names whenever you are ready.');
    } catch (err) {
      setError(`Could not clear the draw: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteExchange() {
    if (!exchange || !isOrganizer) return;
    if (!window.confirm('Delete this whole exchange, including everyone who joined? This cannot be undone.')) return;
    setBusy(true);
    try {
      await deleteExchange(exchange);
      leaveExchange();
      setNotice('Exchange deleted.');
    } catch (err) {
      setError(`Could not delete the exchange: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveParticipant(p: Participant) {
    if (!exchange || !isOrganizer) return;
    if (!window.confirm(`Remove ${p.name} from the exchange?`)) return;
    setBusy(true);
    try {
      await removeParticipant(p);
      await refresh(exchange, userId!);
    } catch (err) {
      setError(`Could not remove ${p.name}: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal() {
    if (!myParticipant || !exchange) return;
    setBusy(true);
    try {
      await markViewed(myParticipant.$id);
      setMyParticipant({ ...myParticipant, hasViewed: true });
      // Refresh the "Who's in" list too, so your own "saw their match" check
      // shows up right away instead of only after a page reload.
      await refresh(exchange, userId!);
    } catch (err) {
      setError(`Could not mark your match as viewed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <Snowfall />
      <header className="hero">
        <div className="sweater" aria-hidden="true">🧶</div>
        <h1>Ugly Sweater Exchange</h1>
        <p className="tagline">
          Everyone visits on their own device. Everyone sees <strong>only</strong> who <em>they</em> got.
        </p>
      </header>

      <main className="card-stack">
        {!isConfigured && (
          <section className="card warning">
            <h2>⚙️ Not connected yet</h2>
            <p>
              This site needs an Appwrite project to store exchanges. Copy <code>.env.example</code> to{' '}
              <code>.env</code>, fill in your Appwrite endpoint, project ID, database ID and collection IDs,
              then redeploy. Full steps are in <code>SETUP.md</code>.
            </p>
          </section>
        )}

        {isConfigured && !userId && !sessionError && (
          <section className="card"><p>Starting your anonymous session… ⛄</p></section>
        )}
        {sessionError && (
          <section className="card warning"><h2>Couldn&apos;t connect</h2><p>{sessionError}</p></section>
        )}

        {error && <section className="card error" role="alert">{error}</section>}
        {notice && <section className="card notice" role="status">{notice}</section>}

        {isConfigured && userId && restoring && (
          <section className="card"><p>Loading your exchange… ⛄</p></section>
        )}

        {isConfigured && userId && !exchange && !restoring && (
          <>
            <section className="card">
              <h2>🎄 Start a new exchange</h2>
              <p className="muted">You&apos;re the organizer. Create it, share the join code, and draw the names once everyone&apos;s in.</p>
              <form onSubmit={handleCreate} className="form">
                <label>
                  Exchange name
                  <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="e.g. Eiche Family Christmas" required maxLength={80} />
                </label>
                <label>
                  Your name
                  <input value={organizerName} onChange={(e) => setOrganizerName(e.target.value)} placeholder="e.g. Paul" required maxLength={60} />
                </label>
                <label>
                  Spending limit (optional)
                  <input value={spendingLimit} onChange={(e) => setSpendingLimit(e.target.value)} placeholder="e.g. $25" maxLength={20} />
                </label>
                <label>
                  Exchange date (optional)
                  <input type="date" value={exchangeDate} onChange={(e) => setExchangeDate(e.target.value)} />
                </label>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Creating…' : 'Create exchange 🎁'}
                </button>
              </form>
            </section>

            <section className="card">
              <h2>🎅 Join an exchange</h2>
              <p className="muted">Got a join code from the organizer? Pop it in here with your name.</p>
              <form onSubmit={handleJoin} className="form">
                <label>
                  Join code
                  <input value={joinCode} onChange={(e) => setJoinCode(parseJoinCodeInput(e.target.value))} placeholder="e.g. K7M2QX (or paste the full invite link)" required className="code-input" />
                </label>
                <label>
                  Your name
                  <input value={joinName} onChange={(e) => setJoinName(e.target.value)} placeholder="e.g. Jessica" required maxLength={60} />
                </label>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Joining…' : 'Join the exchange'}
                </button>
              </form>
            </section>

            <section className="card how">
              <h2>How the secret stays secret 🤫</h2>
              <ol>
                <li>Everyone joins from their own phone or computer — no accounts, no passwords.</li>
                <li>The organizer draws names. Each match is saved so <strong>only that person</strong> can read it.</li>
                <li>You open the site and see just your match. Nobody else&apos;s match is ever shown to you — not even the organizer&apos;s.</li>
              </ol>
            </section>
          </>
        )}

        {isConfigured && userId && exchange && (
          <>
            <section className="card">
              <h2>🎄 {exchange.name}</h2>
              <p className="details">
                {exchange.spendingLimit && <>Spending limit: <strong>{exchange.spendingLimit}</strong> · </>}
                {exchange.exchangeDate && <>Exchange day: <strong>{exchange.exchangeDate}</strong> · </>}
                Organizer: <strong>{exchange.organizerName}</strong>
              </p>
              <div className="join-box">
                <span>Join code: <code className="code">{exchange.joinCode}</code></span>
                <button
                  className="btn small"
                  onClick={() => {
                    navigator.clipboard?.writeText(exchange.joinCode).then(() => setNotice(`Join code ${exchange.joinCode} copied!`));
                  }}
                >
                  Copy code
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    navigator.clipboard?.writeText(shareUrl).then(() => setNotice('Invite link copied! Send it to the family.'));
                  }}
                >
                  Copy invite link
                </button>
              </div>
              {isOrganizer && !exchange.drawn && (
                <p className="muted">Share the code or invite link, wait for everyone to join, then draw names below.</p>
              )}
              <p>
                <button className="btn small" onClick={leaveExchange}>
                  ← Back to start
                </button>
              </p>
            </section>

            {exchange.drawn && myParticipant && (
              <section className="card reveal">
                {assignment ? (
                  <>
                    <Confetti />
                    <h2>🎁 Your match</h2>
                    <p className="muted">Keep it secret — this is only visible on your device.</p>
                    <div className="match">
                      <span className="match-label">You&apos;re buying an ugly sweater for</span>
                      <span className="match-name">🎄 {assignment.receiverName} 🎄</span>
                      {exchange.spendingLimit && (
                        <span className="match-limit">Spending limit: {exchange.spendingLimit}</span>
                      )}
                    </div>
                    {!myParticipant.hasViewed && (
                      <button className="btn primary" onClick={handleReveal} disabled={busy}>
                        Got it — mark as seen
                      </button>
                    )}
                    {myParticipant.hasViewed && <p className="muted">✓ You&apos;ve seen your match.</p>}
                  </>
                ) : (
                  assignmentChecked && (
                    <>
                      <h2>⏳ Names are drawn…</h2>
                      <p>…but we couldn&apos;t find a match for you. If you joined after the draw, ask the organizer to redraw.</p>
                    </>
                  )
                )}
              </section>
            )}

            {exchange.drawn && !myParticipant && (
              <section className="card warning">
                <h2>Names have already been drawn</h2>
                <p>You&apos;re viewing this exchange, but you didn&apos;t join it before the draw, so there&apos;s no match for you here.</p>
              </section>
            )}

            <section className="card">
              <h2>Who&apos;s in ({participants.length})</h2>
              {participants.length === 0 ? (
                <p className="muted">Nobody has joined yet — share the join code!</p>
              ) : (
                <ul className="people">
                  {participants.map((p) => (
                    <li key={p.$id}>
                      <span>🧑‍🎄 {p.name}{p.userId === userId && ' (you)'}</span>
                      <span className="person-status">
                        {exchange.drawn
                          ? p.hasViewed ? '✓ saw their match' : '… hasn\'t peeked yet'
                          : 'joined'}
                        {isOrganizer && !exchange.drawn && p.userId !== userId && (
                          <button className="btn tiny danger" onClick={() => handleRemoveParticipant(p)} disabled={busy}>
                            Remove
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="fineprint">This list never shows who got whom — only who has joined and who has peeked.</p>
            </section>

            {isOrganizer && (
              <section className="card organizer">
                <h2>Organizer controls</h2>
                {!exchange.drawn ? (
                  <>
                    <div className="row">
                      <button className="btn primary" onClick={handleDraw} disabled={busy || participants.length < 3}>
                        {busy ? 'Drawing…' : `Draw the names! (${participants.length} in)`}
                      </button>
                      <button className="btn danger" onClick={handleDeleteExchange} disabled={busy}>Delete exchange</button>
                    </div>
                    {participants.length < 3 && <p className="muted">You need at least 3 people to draw names.</p>}
                  </>
                ) : (
                  <>
                    <p>Names are drawn. You can&apos;t see who got whom — not even your own match shows up here until you open your reveal card above.</p>
                    <div className="row">
                      <button className="btn" onClick={handleRedraw} disabled={busy}>Redraw fresh names</button>
                      <button className="btn danger" onClick={handleDeleteExchange} disabled={busy}>Delete exchange</button>
                    </div>
                  </>
                )}
              </section>
            )}

          </>
        )}
      </main>

      <footer className="footer">
        <p>🎄 Made for family, powered by Appwrite. No passwords, no peeking. 🎄</p>
      </footer>
    </div>
  );
}
