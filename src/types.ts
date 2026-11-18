import type { Models } from 'appwrite';

/** What kind of gift exchange this is. Set once at creation, not editable. */
export type ExchangeType = 'ugly-sweater' | 'secret-santa' | 'gift-exchange';

export interface Exchange extends Models.Document {
  name: string;
  spendingLimit: string;
  exchangeDate: string;
  joinCode: string;
  organizerUserId: string;
  organizerName: string;
  drawn: boolean;
  /** Missing on exchanges created before the type picker — treat as 'ugly-sweater'. */
  exchangeType?: ExchangeType;
}

export interface Participant extends Models.Document {
  exchangeId: string;
  name: string;
  userId: string;
  hasViewed: boolean;
  /** Per-person preference (e.g. sweater size), entered when joining. Optional. */
  preference?: string;
}

export interface Assignment extends Models.Document {
  exchangeId: string;
  giverUserId: string;
  giverName: string;
  receiverUserId: string;
  receiverName: string;
  /** The receiver's preference, copied in by the draw function — only the giver can read this document. */
  receiverPreference?: string;
}
