import { getDatabase } from "firebase-admin/database";
import admin from "firebase-admin";
import { config } from "./config";
import { ParsedTransaction, Account, User, Event, ParsedMint } from "../types";

// https://stackoverflow.com/questions/46549766/whats-the-difference-between-cloud-firestore-and-the-firebase-realtime-database

const app = admin.apps.find((it: any) => it?.name === "[DEFAULT]") ||
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: config.FIREBASE_PROJECT_ID,
            clientEmail: config.FIREBASE_CLIENT_EMAIL,
            privateKey: config.FIREBASE_PRIVATE_KEY!.replace(/\\n/gm, "\n"),
        }),
        databaseURL: config.FIREBASE_DATABASE
    });

const database = getDatabase(app);

class Db {
    public async saveParsedTransactions(parsedTransactions: ParsedTransaction[]): Promise<void> {
        try {
            for (const transaction of parsedTransactions) await this.saveParsedTransaction(transaction);
        } catch (error) {
            console.error("Failed to save parsed transactions:", error);
            throw error;
        }
    }

    public async saveParsedTransaction(parsedTransaction: ParsedTransaction): Promise<void> {
        try {
            if (parsedTransaction.events.length > 0) await this.saveEvents(parsedTransaction.events);
            if (parsedTransaction.accounts.length > 0) await this.saveAccounts(parsedTransaction.accounts);
            if (parsedTransaction.users.length > 0) await this.saveUsers(parsedTransaction.users);
        } catch (error) {
            console.error("Failed to save parsed transaction:", error);
            throw error;
        }
    }

    public async saveMeme(meme: ParsedMint): Promise<void> {
        const memeRef = database.ref(`meme/${meme.mint}`);
        await memeRef.set(meme);
    }

    public async signatureExists(signature: string): Promise<boolean> {
        const signatureRef = database.ref(`events/${signature}`);
        const snapshot = await signatureRef.once('value');
        return snapshot.exists();
    }

    public async getMint(mintAddress: string): Promise<ParsedMint | null> {
        const mintRef = database.ref(`mints/${mintAddress}`);
        const snapshot = await mintRef.once('value');
        if (snapshot.exists()) {
            return snapshot.val() as ParsedMint;
        }
        return null;
    }

    public async saveMint(mintData: ParsedMint): Promise<void> {
        const mintRef = database.ref(`mints/${mintData.mint}`);
        await mintRef.set(mintData);
    }

    private async saveEvents(events: Event[]): Promise<void> {
        const eventsRef = database.ref('events');
        for (const event of events) {
            const eventRef = eventsRef.child(event.signature);
            await eventRef.set(event);
        }
    }

    private async saveAccounts(accounts: Account[]): Promise<void> {
        const accountsRef = database.ref('accounts');
        for (const account of accounts) {
            const accountRef = accountsRef.child(account.address);
            await accountRef.set(account);
        }
    }

    private async saveUsers(users: User[]): Promise<void> {
        const usersRef = database.ref('users');
        for (const user of users) {
            const userRef = usersRef.child(user.address);
            await userRef.set(user);
        }
    }
}

export const db = new Db();
