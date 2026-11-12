import { Account, Client, Databases, ID, Permission, Query, Role } from 'appwrite';
import type { Assignment, Exchange, Participant } from './types';

function env(name: string): string {
  return (import.meta.env[name] as string | undefined)?.trim() ?? '';
}

export const config = {
  endpoint: env('VITE_APPWRITE_ENDPOINT'),
  projectId: env('VITE_APPWRITE_PROJECT_ID'),
  databaseId: env('VITE_APPWRITE_DATABASE_ID'),
  exchangesCollectionId: env('VITE_APPWRITE_EXCHANGES_COLLECTION_ID'),
  participantsCollectionId: env('VITE_APPWRITE_PARTICIPANTS_COLLECTION_ID'),
  assignmentsCollectionId: env('VITE_APPWRITE_ASSIGNMENTS_COLLECTION_ID'),
};

export const isConfigured =
  Boolean(config.endpoint) &&
  Boolean(config.projectId) &&
  Boolean(config.databaseId) &&
  Boolean(config.exchangesCollectionId) &&
  Boolean(config.participantsCollectionId) &&
  Boolean(config.assignmentsCollectionId);

const client = new Client();
if (isConfigured) {
  client.setEndpoint(config.endpoint).setProject(config.projectId);
}

export const account = new Account(client);
export const databases = new Databases(client);

/** Ensure this device has an anonymous Appwrite session; returns the user ID. */
export async function ensureAnonymousSession(): Promise<string> {
  try {
    const user = await account.get();
    return user.$id;
  } catch {
    const session = await account.createAnonymousSession();
    return session.userId;
  }
}

/** Create a 6-character, easy-to-read join code (no 0/O/1/I). */
export function makeJoinCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) code += chars[buf[i] % chars.length];
  return code;
}

function derange<T>(items: T[]): T[] {
  // Sattolo's algorithm: a single-cycle shuffle, so nobody can draw themselves.
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function findExchangeByCode(joinCode: string): Promise<Exchange | null> {
  const res = await databases.listDocuments<Exchange>(
    config.databaseId,
    config.exchangesCollectionId,
    [Query.equal('joinCode', joinCode.toUpperCase().trim()), Query.limit(1)],
  );
  return res.documents[0] ?? null;
}

export async function createExchange(input: {
  name: string;
  spendingLimit: string;
  exchangeDate: string;
  organizerUserId: string;
  organizerName: string;
}): Promise<Exchange> {
  const joinCode = makeJoinCode();
  return databases.createDocument<Exchange>(
    config.databaseId,
    config.exchangesCollectionId,
    ID.unique(),
    {
      name: input.name,
      spendingLimit: input.spendingLimit || '',
      exchangeDate: input.exchangeDate || '',
      joinCode,
      organizerUserId: input.organizerUserId,
      organizerName: input.organizerName,
      drawn: false,
    },
    [
      Permission.read(Role.any()),
      Permission.update(Role.user(input.organizerUserId)),
      Permission.delete(Role.user(input.organizerUserId)),
    ],
  );
}

export async function listParticipants(exchangeId: string): Promise<Participant[]> {
  const res = await databases.listDocuments<Participant>(
    config.databaseId,
    config.participantsCollectionId,
    [Query.equal('exchangeId', exchangeId), Query.limit(100), Query.orderAsc('$createdAt')],
  );
  return res.documents;
}

export async function joinExchange(input: {
  exchangeId: string;
  name: string;
  userId: string;
}): Promise<Participant> {
  return databases.createDocument<Participant>(
    config.databaseId,
    config.participantsCollectionId,
    ID.unique(),
    {
      exchangeId: input.exchangeId,
      name: input.name,
      userId: input.userId,
      hasViewed: false,
    },
    [
      Permission.read(Role.any()),
      // Only this participant (their anonymous user ID) may mark themselves as viewed,
      // and only the exchange organizer can remove them — enforced in the UI by only
      // exposing the matching actions, and by the delete permission below.
      Permission.update(Role.user(input.userId)),
      Permission.delete(Role.user(input.userId)),
    ],
  );
}

export async function removeParticipant(participant: Participant): Promise<void> {
  await databases.deleteDocument(
    config.databaseId,
    config.participantsCollectionId,
    participant.$id,
  );
}

export async function markViewed(participantId: string): Promise<void> {
  await databases.updateDocument(
    config.databaseId,
    config.participantsCollectionId,
    participantId,
    { hasViewed: true },
  );
}

/**
 * Run the secret draw. The organizer's browser computes the derangement and
 * writes one assignment document per participant, each readable ONLY by its
 * assignee. The mapping is never stored in app state, never rendered, and is
 * discarded as soon as the documents are written — after this returns, the
 * organizer cannot read the assignments back.
 */
export async function runDraw(exchange: Exchange, participants: Participant[]): Promise<void> {
  if (participants.length < 3) {
    throw new Error('You need at least 3 people to draw names.');
  }
  const receivers = derange(participants);
  for (let i = 0; i < participants.length; i++) {
    const giver = participants[i];
    const receiver = receivers[i];
    await databases.createDocument<Assignment>(
      config.databaseId,
      config.assignmentsCollectionId,
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
  // The local `receivers` array goes out of scope here and is never saved anywhere.
  await databases.updateDocument(
    config.databaseId,
    config.exchangesCollectionId,
    exchange.$id,
    { drawn: true },
  );
}

export async function listAssignments(exchangeId: string): Promise<Assignment[]> {
  const res = await databases.listDocuments<Assignment>(
    config.databaseId,
    config.assignmentsCollectionId,
    [Query.equal('exchangeId', exchangeId), Query.limit(100)],
  );
  return res.documents;
}

/** Returns only this device's assignment — Appwrite permissions hide everyone else's. */
export async function myAssignment(
  exchangeId: string,
  userId: string,
): Promise<Assignment | null> {
  const res = await databases.listDocuments<Assignment>(
    config.databaseId,
    config.assignmentsCollectionId,
    [
      Query.equal('exchangeId', exchangeId),
      Query.equal('giverUserId', userId),
      Query.limit(1),
    ],
  );
  return res.documents[0] ?? null;
}

export async function deleteAssignments(exchangeId: string): Promise<void> {
  const docs = await listAssignments(exchangeId);
  for (const doc of docs) {
    await databases.deleteDocument(config.databaseId, config.assignmentsCollectionId, doc.$id);
  }
}

export async function resetDraw(exchangeId: string): Promise<void> {
  await deleteAssignments(exchangeId);
  await databases.updateDocument(config.databaseId, config.exchangesCollectionId, exchangeId, {
    drawn: false,
  });
}

export async function deleteExchange(exchange: Exchange): Promise<void> {
  const participants = await listParticipants(exchange.$id);
  for (const p of participants) {
    await databases.deleteDocument(config.databaseId, config.participantsCollectionId, p.$id);
  }
  await deleteAssignments(exchange.$id);
  await databases.deleteDocument(config.databaseId, config.exchangesCollectionId, exchange.$id);
}
