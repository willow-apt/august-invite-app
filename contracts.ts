import { Datastore, Entity } from '@google-cloud/datastore'

export interface Invite {
    expiration: Date;
    maxEntries: number;
    guestName: string;
}

export interface InviteEntity {
}