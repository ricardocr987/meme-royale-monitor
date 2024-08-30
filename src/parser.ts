import { BorshCoder } from "@coral-xyz/anchor";
import { MEMEROYALE_PROGRAM_ID } from "./lib/constants";
import { accountDiscriminators } from "./lib/meme";
import { Fetcher } from "./fetcher";
import BN from "bn.js";
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { MintLayout } from "./lib/solana";
import { Database } from "./lib/db";
import { config } from "./lib/config";
import { 
    ParsedTransactionWithMeta, 
    PublicKey, 
    SystemProgram,
    PartiallyDecodedInstruction, 
    ParsedInstruction
} from "@solana/web3.js";
import bs58 from 'bs58';
import { 
    Account, 
    ParsedTransaction, 
    User, 
    Event, 
    ParsedMint, 
    Mint 
} from "./types";

export class Parser {
    private readonly coder: BorshCoder;
    private fetcher!: Fetcher;
    private readonly db: Database;

    constructor(db: Database, coder: BorshCoder) {
        this.coder = coder;
        this.db = db;
    }

    public async parseTransactions(transactions: ParsedTransactionWithMeta[]): Promise<void> {
        await Promise.all(transactions.map(tx => this.parseTransaction(tx)));
    }

    public async parseTransaction(tx: ParsedTransactionWithMeta): Promise<ParsedTransaction> {
        const { transaction, meta } = tx;

        const signers = transaction.message.accountKeys.filter(x => x.signer).map(x => String(x.pubkey));
        const users = await this.parseUsers(signers);
        const events: Event[] = [];
        const accounts: Account[] = [];
    
        for (const instruction of transaction.message.instructions) {
            if (String(instruction.programId) === MEMEROYALE_PROGRAM_ID) {
                const parsedEvent = await this.parseEvent(
                    instruction as PartiallyDecodedInstruction, 
                    signers, 
                    transaction.signatures, 
                    tx.blockTime || 0
                );
                if (parsedEvent) events.push(parsedEvent);
            }
        }

        if (meta && meta.innerInstructions) {
            for (const innerInstruction of meta.innerInstructions) {
                for (const instruction of innerInstruction.instructions) {
                    if (String(instruction.programId) === SystemProgram.programId.toBase58()) {
                        const parsedAccount = await this.parseAccount(instruction as ParsedInstruction);
                        if (parsedAccount) accounts.push(parsedAccount);
                    }
                }
            }
        }

        const parsedTransaction = { events, accounts, users };
        await this.db.saveTransaction(parsedTransaction);
        return parsedTransaction;
    }

    private async parseEvent(
        instruction: PartiallyDecodedInstruction, 
        signers: string[], 
        signatures: string[],
        timestamp: number
    ): Promise<Event | null> {
        try {
            const decodedInstruction = this.coder.instruction.decode(
                bs58.decode(instruction.data),
                "base58"
            );
            if (!decodedInstruction) return null;
            return {
                signature: signatures[0],
                data: this.normalizeData((decodedInstruction.data as any).args),
                type: decodedInstruction.name,
                accounts: instruction.accounts.map(x => String(x)),
                signers,
                timestamp,
            };
        } catch (e: any) {
            console.error('Error parsing event:', e.message);
            return null;
        }
    }
    
    private async parseAccount(
        instruction: ParsedInstruction,
    ): Promise<Account | undefined> {
        if (instruction.parsed.type !== 'createAccount' || instruction.program !== 'system') return;

        const address = instruction.parsed.info.newAccount;

        try {
            const accountInfo = await config.RPC.getAccountInfo(new PublicKey(address));
            if (!accountInfo) return;

            const discriminator = accountInfo.data.slice(0, 8).toString('hex');
            const accountName = accountDiscriminators[discriminator];
            if (accountName) {
                const deserializedAccount = this.coder.accounts.decode(
                    accountName.charAt(0).toLowerCase() + accountName.slice(1), 
                    accountInfo.data
                );

                if (deserializedAccount) {
                    return {
                        address,
                        type: accountName,
                        ...this.normalizeData(deserializedAccount),
                    };
                }
            } else if (accountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
                const mintData = await this.parseMint(address, accountInfo.data);
                await this.db.saveMeme(mintData);
            }
        } catch (error: any) {
            console.error('Error parsing account:', address, error.message);
        }

        return undefined;
    }

    public async parseMint(mint: string, data: Buffer): Promise<ParsedMint> {
        const decoded: Mint = MintLayout.decode(data);
        const mintData = this.normalizeData({
            mint,
            ...decoded
        });
        await this.db.saveMint(mintData);

        return mintData;
    }
    
    private async parseUsers(signers: string[]): Promise<User[]> {
        const parsedUsers = await Promise.all(signers.map(async (address) => {
            try {
                const { wealth, tokens } = await this.fetcher.getUserWealth(new PublicKey(address));
                return { address, wealth, tokens };
            } catch (error: any) {
                console.error(`Error fetching user wealth for ${address}: ${error.message}`);
                return null;
            }
        }));
    
        return parsedUsers.filter((user): user is User => user !== null);
    }

    private normalizeData(data: any): any {
        const normalizedData: any = {};
        for (const [key, value] of Object.entries(data)) {
            if (value instanceof PublicKey) {
                normalizedData[key] = value.toBase58();
            } else if (value instanceof BN) {
                normalizedData[key] = value.toString(16);
            } else if (Array.isArray(value) && value.every((byte: number) => typeof byte === 'number')) {
                normalizedData[key] = String.fromCharCode(...value);
            } else {
                normalizedData[key] = value;
            }
        }
        return normalizedData;
    }
}