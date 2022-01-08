import { Datastore, Entity } from '@google-cloud/datastore'

export interface Invite {
    expiration: Date;
    maxEntries: number;
    guestName: string;
}

export interface SecretKnock {
  pattern: string;
  expiration: Date;
}

export interface InviteEntity {
}
