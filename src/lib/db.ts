import { getDatabase } from "firebase-admin/database";
import admin from "firebase-admin";
import { config } from "./config";
import { ParsedTransaction, Account, User, Event, ParsedMint } from "../types";

export class Database {
    private database: admin.database.Database;

    constructor() {
        const app = admin.apps.find((it: any) => it?.name === "[DEFAULT]") ||
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: config.FIREBASE_PROJECT_ID,
                    clientEmail: config.FIREBASE_CLIENT_EMAIL,
                    privateKey: config.FIREBASE_PRIVATE_KEY!.replace(/\\n/gm, "\n"),
                }),
                databaseURL: config.FIREBASE_DATABASE
            });

        this.database = getDatabase(app);
    }

    public async saveTransactions(parsedTransactions: ParsedTransaction[]): Promise<void> {
        try {
            await Promise.all(parsedTransactions.map(tx => this.saveTransaction(tx)));
        } catch (error) {
            console.error("Failed to save parsed transactions:", error);
            throw error;
        }
    }

    public async saveTransaction(parsedTransaction: ParsedTransaction): Promise<void> {
        try {
            const savePromises = [
                this.saveEvents(parsedTransaction.events),
                this.saveAccounts(parsedTransaction.accounts),
                this.saveUsers(parsedTransaction.users)
            ];
            await Promise.all(savePromises);
        } catch (error) {
            console.error("Failed to save parsed transaction:", error);
            throw error;
        }
    }

    public async saveMeme(meme: ParsedMint): Promise<void> {
        const memeRef = this.database.ref(`memes/${meme.mint}`);
        await memeRef.set(meme);
    }

    public async signatureExists(signature: string): Promise<boolean> {
        const eventsRef = this.database.ref('events');
        const snapshot = await eventsRef.orderByChild('signature').equalTo(signature).once('value');
        return snapshot.exists();
    }

    public async getMint(mintAddress: string): Promise<ParsedMint | null> {
        const mintRef = this.database.ref(`mints/${mintAddress}`);
        const snapshot = await mintRef.once('value');
        return snapshot.exists() ? snapshot.val() as ParsedMint : null;
    }

    public async saveMint(mintData: ParsedMint): Promise<void> {
        const mintRef = this.database.ref(`mints/${mintData.mint}`);
        await mintRef.set(mintData);
    }

    private async saveEvents(events: Event[]): Promise<void> {
        const savePromises = events.map(event => {
            const eventRef = this.database.ref(`events/${event.type}/${event.signature}`);
            return eventRef.set(event);
        });
        await Promise.all(savePromises);
    }

    private async saveAccounts(accounts: Account[]): Promise<void> {
        const accountsRef = this.database.ref('accounts');
        const savePromises = accounts.map(account => {
            const accountRef = accountsRef.child(account.address);
            return accountRef.set(account);
        });
        await Promise.all(savePromises);
    }

    private async saveUsers(users: User[]): Promise<void> {
        const usersRef = this.database.ref('users');
        const savePromises = users.map(user => {
            const userRef = usersRef.child(user.address);
            return userRef.set(user);
        });
        await Promise.all(savePromises);
    }
}