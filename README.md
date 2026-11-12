# 🎄 Ugly Sweater Exchange

A secret gift exchange for the family. Everyone visits the site on their own
device, joins with a code, and sees **only** who *they* got — nobody else's
match, not even the organizer's.

- **Stack:** Vite + React + TypeScript, Appwrite JS SDK. No backend of our own.
- **Hosting:** static site, ready for Netlify (`netlify.toml` included).
- **Auth:** anonymous Appwrite sessions — no passwords, no emails, no accounts.

## How it works

1. **Organizer** creates an exchange (name, optional spending limit and date).
   They get a 6-character join code and an invite link (`?code=XXXXXX`).
2. **Family members** open the link on their own phone/computer, enter the
   join code and their name. A participant record is created, tied to their
   anonymous Appwrite user ID.
3. **Organizer draws names** once everyone is in. The draw is a derangement
   (Sattolo shuffle), so nobody can draw themselves. For each participant the
   organizer's browser writes one assignment document that is readable **only
   by that assignee's Appwrite user ID**. The mapping is never stored in the
   app, never rendered, and is discarded as soon as the documents are written
   — after the draw, the organizer cannot read the assignments back.
4. **Each person** reopens the site on their own device and sees only their
   match, with a confetti reveal. A status list shows who has joined and who
   has peeked — never who got whom.
5. **Organizer controls:** redraw fresh names, remove a participant (before
   the draw), or delete the whole exchange.

## Security boundary — read this

Secrecy is enforced by **Appwrite document permissions**: each assignment
document grants `read` only to `Role.user(<assignee's user ID>)`, so the
Appwrite API itself refuses to return anyone else's assignment. The UI also
never lists assignments.

One honest caveat: the organizer's browser necessarily computes the draw, so
during those few seconds the mapping exists in that browser's memory. The app
deliberately never saves it, never renders it, and drops it immediately after
writing the assignment documents. If that threat model isn't acceptable for
your family, the alternative is an Appwrite Function that runs the draw
server-side — but that is outside this app's scope.

## Quick start

```bash
cp .env.example .env   # then fill in your Appwrite values (see SETUP.md)
npm install
npm run dev            # local dev server
npm run build          # production build -> dist/
```

## Deploy to Netlify

Option A — drag and drop: run `npm run build`, then drag the `dist/` folder
onto [app.netlify.com/drop](https://app.netlify.com/drop).

Option B — connect the repo: create a GitHub repo, push this folder, then in
Netlify choose **Add new site → Import an existing project**. Build settings
are already in `netlify.toml` (`npm run build`, publish `dist/`). Then add
the environment variables from your `.env` in **Site settings → Environment
variables** and redeploy.

> ⚠️ The environment variables must be set in Netlify (not just in a local
> `.env` file) or the deployed site will show the "Not connected yet" banner.

## Configuration

All config comes from environment variables (Vite `VITE_*` vars, baked in at
build time — that's why you must redeploy after changing them):

| Variable | What it is |
| --- | --- |
| `VITE_APPWRITE_ENDPOINT` | Appwrite endpoint, e.g. `https://cloud.appwrite.io/v1` |
| `VITE_APPWRITE_PROJECT_ID` | Appwrite project ID |
| `VITE_APPWRITE_DATABASE_ID` | Database ID |
| `VITE_APPWRITE_EXCHANGES_COLLECTION_ID` | `exchanges` collection ID |
| `VITE_APPWRITE_PARTICIPANTS_COLLECTION_ID` | `participants` collection ID |
| `VITE_APPWRITE_ASSIGNMENTS_COLLECTION_ID` | `assignments` collection ID |

See **SETUP.md** for the exact Appwrite console steps: project, anonymous
auth, database, collections, attributes, and permissions.

## Project layout

```
src/
  main.tsx        entry point
  App.tsx         all screens: create / join / exchange / reveal
  appwrite.ts     Appwrite client, sessions, draw + reveal logic
  types.ts        Exchange / Participant / Assignment document types
  index.css       festive styling, snowfall + confetti
netlify.toml      Netlify build + SPA redirect
.env.example      placeholder env vars (never put real IDs here)
SETUP.md          step-by-step Appwrite console setup
```
