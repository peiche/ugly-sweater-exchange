import type { Models } from 'appwrite';

export interface Exchange extends Models.Document {
  name: string;
  spendingLimit: string;
  exchangeDate: string;
  joinCode: string;
  organizerUserId: string;
  organizerName: string;
  drawn: boolean;
}

export interface Participant extends Models.Document {
  exchangeId: string;
  name: string;
  userId: string;
  hasViewed: boolean;
}

export interface Assignment extends Models.Document {
  exchangeId: string;
  giverUserId: string;
  giverName: string;
  receiverUserId: string;
  receiverName: string;
}
