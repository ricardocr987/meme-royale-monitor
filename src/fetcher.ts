import { MEMEROYALE_PROGRAM_ID, SOL_DECIMALS, SOL_MINT } from "./lib/constants";
import { Parser } from "./parser";
import { PublicKey, ParsedTransactionWithMeta } from "@solana/web3.js";
import { config } from "./lib/config";
import ky from "ky";
import { JupQuote, ParsedMint, TokenData, User, WealthData } from "./types";
import BigNumber from "bignumber.js";
import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Database } from "./lib/db";

export class Fetcher {
    private parser!: Parser;
    private readonly db: Database;
    private static readonly MAX_BATCH_SIZE = 100;
    private static readonly PRICE_URL = "https://price.jup.ag/v6/price";
    private static readonly VS_TOKEN = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    private refreshInterval: Timer | null = null;

    constructor(db: Database) {
        this.db = db;
    }

    public async init(): Promise<void> {
        await this.history(MEMEROYALE_PROGRAM_ID);

        this.startRefreshHoldersInterval();
    }

    public async history(account: string): Promise<void> {
        const pubkey = new PublicKey(account);
        await this.transactions(pubkey, async (transactions) => {
            await this.parser.parseTransactions(transactions);
        });
    }

    public async getUserWealth(userPublicKey: PublicKey): Promise<WealthData> {
        const [solBalance, solPriceData, tokenAccounts] = await Promise.all([
            config.RPC.getBalance(userPublicKey),
            this.getPrices([SOL_MINT]),
            this.getTokenAccounts(userPublicKey.toBase58()),
        ]);

        const solAmount = new BigNumber(solBalance).shiftedBy(-SOL_DECIMALS);
        let totalWealth = new BigNumber(0);
        const tokens: TokenData[] = [];

        if (solPriceData && solPriceData[SOL_MINT]) {
            const solValue = solAmount.times(solPriceData[SOL_MINT]);
            totalWealth = totalWealth.plus(solValue);
            tokens.push({ mint: SOL_MINT, balance: solAmount.toString(16) });
        }

        const mintAddresses = tokenAccounts.map(x => x.data.mint.toBase58());
        const [mints, prices] = await Promise.all([
            this.getMints(mintAddresses),
            this.getPrices(mintAddresses),
        ]);

        for (const accountData of tokenAccounts) {
            const mint = accountData.data.mint.toBase58();
            const mintData = mints[mint];
            if (!mintData) continue;

            const amount = accountData.data.amount.shiftedBy(-mintData.decimals);
            const price = prices[mint];
            if (!price) continue;

            totalWealth = totalWealth.plus(amount.times(price));
            tokens.push({ mint, balance: amount.toString(16) });
        }

        return { wealth: totalWealth.toString(16), tokens };
    }

    private startRefreshHoldersInterval(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.refreshInterval = setInterval(() => this.refreshHoldersInterval(), 1800000);
        this.refreshHoldersInterval();
    }

    private async refreshHoldersInterval(): Promise<void> {
        try {
            const users = await this.db.getUsers();
            const updatedUsers: User[] = [];

            for (const [address] of Object.entries(users)) {
                try {
                    const publicKey = new PublicKey(address);
                    const wealthData = await this.getUserWealth(publicKey);
                    updatedUsers.push({ address, ...wealthData });
                } catch (error) {
                    console.error(`Error updating wealth data for user ${address}:`, error);
                }
            }

            await this.db.saveUsers(updatedUsers);
            console.log('Finished refreshing holders wealth data');
        } catch (error) {
            console.error('Error in refreshHoldersInterval:', error);
        }
    }
    private async filterExistingSignatures(signatures: string[]): Promise<string[]> {
        const existenceChecks = signatures.map(signature => this.db.signatureExists(signature));
        const existenceResults = await Promise.all(existenceChecks);
        return signatures.filter((_, index) => !existenceResults[index]);
    }

    private async getTokenAccounts(userKey: string): Promise<Array<{ pubkey: string; data: any }>> {
        const publicKey = new PublicKey(userKey);
        const tokenAccounts = await config.RPC.getTokenAccountsByOwner(
            publicKey,
            { programId: TOKEN_PROGRAM_ID },
        );

        return tokenAccounts.value
            .map(account => ({
                pubkey: account.pubkey.toBase58(),
                data: {
                    ...AccountLayout.decode(account.account.data),
                    amount: new BigNumber(AccountLayout.decode(account.account.data).amount.toString()),
                },
            }))
            .filter(x => x.data.amount.isGreaterThan(0));
    }

    private async getMints(mintAddresses: string[]): Promise<Record<string, ParsedMint>> {
        const mints: Record<string, ParsedMint> = {};
        const mintBatches = this.chunkArray(mintAddresses, Fetcher.MAX_BATCH_SIZE);

        for (const batch of mintBatches) {
            const [cachedMints, mintAddressesToFetch] = await this.separateCachedAndUncachedMints(batch);
            Object.assign(mints, cachedMints);

            if (mintAddressesToFetch.length > 0) {
                const mintPublicKeys = mintAddressesToFetch.map(address => new PublicKey(address));
                const mintAccountInfos = await config.RPC.getMultipleAccountsInfo(mintPublicKeys);

                for (let idx = 0; idx < mintAccountInfos.length; idx++) {
                    const accountInfo = mintAccountInfos[idx];
                    if (accountInfo?.data) {
                        const mintData = await this.parser.parseMint(mintAddressesToFetch[idx], accountInfo.data);
                        mints[mintAddressesToFetch[idx]] = mintData;
                    }
                }
            }
        }

        return mints;
    }

    private async separateCachedAndUncachedMints(mintAddresses: string[]): Promise<[Record<string, ParsedMint>, string[]]> {
        const cachedMints: Record<string, ParsedMint> = {};
        const mintAddressesToFetch: string[] = [];

        await Promise.all(mintAddresses.map(async (mintAddress) => {
            const cachedMint = await this.db.getMint(mintAddress);
            if (cachedMint) {
                cachedMints[mintAddress] = cachedMint;
            } else {
                mintAddressesToFetch.push(mintAddress);
            }
        }));

        return [cachedMints, mintAddressesToFetch];
    }

    private async getPrices(mintAddresses: string[]): Promise<Record<string, number>> {
        const pricesRecord: Record<string, number> = {};
        const mintBatches = this.chunkArray(mintAddresses, Fetcher.MAX_BATCH_SIZE);

        for (const batch of mintBatches) {
            await this.fetchPricesForBatch(batch, pricesRecord);
        }

        return pricesRecord;
    }

    private async fetchPricesForBatch(batch: string[], pricesRecord: Record<string, number>): Promise<void> {
        try {
            const response = await ky.get(Fetcher.PRICE_URL, {
                searchParams: { ids: batch.join(","), vsToken: Fetcher.VS_TOKEN },
                retry: { limit: 5, methods: ["get"], statusCodes: [408, 429, 500, 502, 503, 504] },
            }).json<JupQuote>();

            for (const mint of batch) {
                const price = response.data?.[mint]?.price;
                if (price) pricesRecord[mint] = price;
            }
        } catch (error: any) {
            console.error(`Error fetching prices for batch: ${error.message}`);
        }
    }

    private async transactions(
        pubkey: PublicKey,
        batchProcessor: (transactions: ParsedTransactionWithMeta[]) => Promise<string | undefined | void>
    ): Promise<string | undefined> {
        let before: string | undefined;
        const limit = 10;

        while (true) {
            const signatures = await config.RPC.getSignatures(pubkey, { before, limit });
            if (signatures.length === 0) break;
            before = signatures[signatures.length - 1].signature;

            const filteredSignatures = await this.filterExistingSignatures(signatures.filter(x => !x.err).map(x => x.signature));
            const rawTransactions = await config.RPC.getBatchTransactions(filteredSignatures);
            const transactions = rawTransactions.filter((tx): tx is ParsedTransactionWithMeta => tx !== null);
            const result = await batchProcessor(transactions);
            
            if (result) return result;

        }

        console.log(`[getTransactions] Finished processing all transaction batches for account: ${pubkey.toBase58()}`);
        return undefined;
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        return Array.from({ length: Math.ceil(array.length / size) }, (_, index) =>
            array.slice(index * size, (index + 1) * size)
        );
    }
}