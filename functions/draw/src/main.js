/**
 * Ugly Sweater Exchange — draw function.
 *
 * Why this runs server-side: from a browser, Appwrite only lets a user grant
 * document permissions to roles they own (any, all users, their own user ID,
 * or teams they belong to). It cannot grant read access to *another* user.
 * So the draw — which writes one assignment per participant, readable ONLY
 * by that participant — has to run here, with an API key, instead of in the
 * React app. The mapping is computed here and never leaves the function.
 *
 * Actions (body: { exchangeId, action }):
 *   draw   — derange participants, write assignments, mark exchange drawn.
 *             Also clears any leftover assignments first (e.g. from the old
 *             client-side draw that failed halfway).
 *   reset  — delete all assignments, mark exchange not drawn.
 *   delete — delete assignments + participants + the exchange itself.
 *
 * Only the exchange's organizer may call it: Appwrite passes the calling
 * user's ID in the x-appwrite-user-id header for executions started from a
 * signed-in client, and it must match the exchange's organizerUserId.
 *
 * Variables (set on the function in the Appwrite console):
 *   APPWRITE_API_KEY            (secret) API key with databases read/write.
 *   APPWRITE_DATABASE_ID        defaults to the ugly-sweater-exchange database.
 *   APPWRITE_EXCHANGES_TABLE_ID / APPWRITE_PARTICIPANTS_TABLE_ID /
 *   APPWRITE_ASSIGNMENTS_TABLE_ID  default to exchanges / participants / assignments.
 * APPWRITE_FUNCTION_API_ENDPOINT and APPWRITE_FUNCTION_PROJECT_ID are
 * provided automatically by the Appwrite runtime.
 */

const { Client, Databases, ID, Permission, Query, Role } = require('node-appwrite');

const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || '6af61068003aed39b1a3';
const EXCHANGES_TABLE_ID = process.env.APPWRITE_EXCHANGES_TABLE_ID || 'exchanges';
const PARTICIPANTS_TABLE_ID = process.env.APPWRITE_PARTICIPANTS_TABLE_ID || 'participants';
const ASSIGNMENTS_TABLE_ID = process.env.APPWRITE_ASSIGNMENTS_TABLE_ID || 'assignments';

/** Sattolo's algorithm: a single-cycle shuffle, so nobody can draw themselves. */
function derange(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function deleteAssignments(databases, exchangeId) {
  const res = await databases.listDocuments(DATABASE_ID, ASSIGNMENTS_TABLE_ID, [
    Query.equal('exchangeId', exchangeId),
    Query.limit(100),
  ]);
  for (const doc of res.documents) {
    await databases.deleteDocument(DATABASE_ID, ASSIGNMENTS_TABLE_ID, doc.$id);
  }
}

module.exports = async ({ req, res, log, error }) => {
  try {
    const apiKey = process.env.APPWRITE_API_KEY;
    if (!apiKey) {
      return res.json({ ok: false, error: 'Server is missing APPWRITE_API_KEY.' }, 500);
    }

    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(apiKey);
    const databases = new Databases(client);

    let body = {};
    try {
      body = req.bodyJson ?? JSON.parse(req.body || '{}');
    } catch {
      return res.json({ ok: false, error: 'Request body must be JSON.' }, 400);
    }
    const { exchangeId, action } = body;
    if (!exchangeId || typeof exchangeId !== 'string') {
      return res.json({ ok: false, error: 'exchangeId is required.' }, 400);
    }
    if (!['draw', 'reset', 'delete'].includes(action)) {
      return res.json({ ok: false, error: "action must be 'draw', 'reset', or 'delete'." }, 400);
    }

    const exchange = await databases.getDocument(DATABASE_ID, EXCHANGES_TABLE_ID, exchangeId);
    const callerId = req.headers['x-appwrite-user-id'];
    if (!callerId || callerId !== exchange.organizerUserId) {
      return res.json({ ok: false, error: 'Only the organizer can do this.' }, 403);
    }

    if (action === 'delete') {
      await deleteAssignments(databases, exchangeId);
      const participants = await databases.listDocuments(DATABASE_ID, PARTICIPANTS_TABLE_ID, [
        Query.equal('exchangeId', exchangeId),
        Query.limit(100),
      ]);
      for (const p of participants.documents) {
        await databases.deleteDocument(DATABASE_ID, PARTICIPANTS_TABLE_ID, p.$id);
      }
      await databases.deleteDocument(DATABASE_ID, EXCHANGES_TABLE_ID, exchangeId);
      log(`Deleted exchange ${exchangeId}.`);
      return res.json({ ok: true });
    }

    if (action === 'reset') {
      await deleteAssignments(databases, exchangeId);
      await databases.updateDocument(DATABASE_ID, EXCHANGES_TABLE_ID, exchangeId, { drawn: false });
      log(`Reset draw for exchange ${exchangeId}.`);
      return res.json({ ok: true });
    }

    // action === 'draw'
    if (exchange.drawn) {
      return res.json({ ok: false, error: 'Names have already been drawn for this exchange.' }, 400);
    }
    const participants = await databases.listDocuments(DATABASE_ID, PARTICIPANTS_TABLE_ID, [
      Query.equal('exchangeId', exchangeId),
      Query.limit(100),
    ]);
    if (participants.documents.length < 3) {
      return res.json({ ok: false, error: 'You need at least 3 people to draw names.' }, 400);
    }

    // Clear any leftover assignments (e.g. from a failed draw attempt) so the
    // new draw starts clean and nobody ends up with two matches.
    await deleteAssignments(databases, exchangeId);

    const receivers = derange(participants.documents);
    for (let i = 0; i < participants.documents.length; i++) {
      const giver = participants.documents[i];
      const receiver = receivers[i];
      await databases.createDocument(
        DATABASE_ID,
        ASSIGNMENTS_TABLE_ID,
        ID.unique(),
        {
          exchangeId: exchange.$id,
          giverUserId: giver.userId,
          giverName: giver.name,
          receiverUserId: receiver.userId,
          receiverName: receiver.name,
        },
        [
          // Secrecy lives here: only the assignee's anonymous user ID can read this.
          Permission.read(Role.user(giver.userId)),
          // The organizer may delete assignments (for redraw / start over) but
          // deliberately has NO read permission, so they cannot peek afterwards.
          Permission.delete(Role.user(exchange.organizerUserId)),
        ],
      );
    }
    await databases.updateDocument(DATABASE_ID, EXCHANGES_TABLE_ID, exchangeId, { drawn: true });
    log(`Drew names for exchange ${exchangeId}: ${participants.documents.length} assignments.`);
    return res.json({ ok: true, count: participants.documents.length });
  } catch (err) {
    error(err && err.message ? err.message : String(err));
    return res.json({ ok: false, error: err && err.message ? err.message : 'Draw failed.' }, 500);
  }
};
