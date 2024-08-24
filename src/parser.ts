import { BorshCoder } from "@coral-xyz/anchor";
import { 
    VersionedTransactionResponse, 
    PublicKey, 
    ConfirmedTransactionMeta, 
    SystemProgram,
    SystemInstruction,
    TransactionInstruction
} from "@solana/web3.js";
import { MEMEROYALE_PROGRAM_ID } from "./lib/constants";
import { config } from "./lib/config";
import { 
    Account, 
    ParsedTransaction, 
    User, 
    VersionedTransaction, 
    Event, 
    ParsedMint, 
    Mint 
} from "./types";
import { accountDiscriminators } from "./lib/meme";
import { Fetcher } from "./fetcher";
import BN from "bn.js";
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { MintLayout } from "./lib/solana";
import { db } from "./lib/db";
import bs58 from 'bs58';

export class Parser {
    private coder: BorshCoder;
    private fetcher!: Fetcher;

    constructor(coder: BorshCoder) {
        this.coder = coder;
    }

    setFetcher(fetcher: Fetcher) {
        this.fetcher = fetcher;
    }

    public async parseTransactions(transactions: VersionedTransactionResponse[]): Promise<ParsedTransaction[]> {
        const parsedTransactions = [];
        for (const transaction of transactions) {
            const parsedTransaction = await this.parseTransaction(transaction.transaction, transaction.meta || undefined);
            parsedTransactions.push(parsedTransaction);
        }

        return parsedTransactions;
    }

    public async parseTransaction(transaction: VersionedTransaction, meta?: ConfirmedTransactionMeta): Promise<ParsedTransaction> {
        const events = await this.parseEvents(transaction);
        const accounts = await this.parseAccounts(transaction, meta);
        const users = await this.parseUsers(transaction);
        
        return { events, accounts, users };
    }

    private async parseEvents(transaction: VersionedTransaction): Promise<Event[]> {
        const parsedEvents: Event[] = [];

        try {
            for (const instruction of transaction.message.compiledInstructions) {
                const programId = transaction.message.staticAccountKeys[instruction.programIdIndex];
                if (programId.toBase58() !== MEMEROYALE_PROGRAM_ID) continue;
    
                const decodedInstruction = this.coder.instruction.decode(
                    Buffer.from(instruction.data),
                    "base58"
                );
                if (!decodedInstruction) continue;
                const accountMetas = instruction.accountKeyIndexes.map((idx) => ({
                    pubkey: transaction.message.staticAccountKeys[idx],
                    isSigner: transaction.message.isAccountSigner(idx),
                    isWritable: transaction.message.isAccountWritable(idx),
                }));
    
                let data = (decodedInstruction.data as any).args;
                for (const key in data) {
                    if (key && data[key] instanceof PublicKey) {
                        data[key] = data[key].toBase58();
                    } else if (key && data[key] instanceof BN) {
                        data[key] = data[key].toString(16);
                    }
                    else if (key && Array.isArray(data[key]) && data[key].every((byte: number) => typeof byte === 'number')) {
                        data[key] = String.fromCharCode(...data[key]);
                    }
                }
    
                parsedEvents.push({
                    signature: transaction.signatures[0],
                    type: decodedInstruction.name,
                    signer: accountMetas.find((meta) => meta.isSigner)?.pubkey.toBase58() || "",
                    accounts: accountMetas.map((meta) => (meta.pubkey.toBase58())),
                    data
                });
            }
        } catch (e: any) {
            console.log('Error on event:', e.message)
        }

        return parsedEvents;
    }

    private async parseAccounts(transaction: VersionedTransaction, meta?: ConfirmedTransactionMeta): Promise<Account[]> {
        const parsedAccounts: Account[] = [];
    
        if (meta?.innerInstructions) {
            for (const innerInstruction of meta.innerInstructions) {
                for (const instruction of innerInstruction.instructions) {
                    const programId = transaction.message.staticAccountKeys[instruction.programIdIndex];
                    if (!programId.equals(SystemProgram.programId) || !instruction.accounts[1]) continue;

                    const keys = instruction.accounts.map((idx) => ({
                        pubkey: transaction.message.staticAccountKeys[idx],
                        isSigner: transaction.message.isAccountSigner(idx),
                        isWritable: transaction.message.isAccountWritable(idx),
                    }));
                    const instructionType = SystemInstruction.decodeInstructionType(new TransactionInstruction({
                        keys,
                        programId,
                        data: bs58.decode(instruction.data),
                    }));
                    if (instructionType !== 'Create') continue;

                    const address = transaction.message.staticAccountKeys[instruction.accounts[1]];
                    const account = await this.parseAccount(address);
                    if (account) parsedAccounts.push(account);
                }
            }
        }
    
        return parsedAccounts;
    }
    
    private async parseAccount(address: PublicKey) {
        try {            
            const accountInfo = await config.RPC.getAccountInfo(address);
            if (!accountInfo || accountInfo.data.length < 8 || accountInfo.executable) return;

            const discriminator = accountInfo.data.slice(0, 8).toString('hex');
            const accountName = accountDiscriminators[discriminator];
            if (accountName) {
                const deserializedAccount = this.coder.accounts.decode(
                    accountName.charAt(0).toLowerCase() + accountName.slice(1), 
                    accountInfo.data
                );

                if (deserializedAccount) {
                    for (const key in deserializedAccount) {
                        if (key && deserializedAccount[key] instanceof PublicKey) {
                            deserializedAccount[key] = deserializedAccount[key].toBase58();
                        } else if (key && deserializedAccount[key] instanceof BN) {
                            deserializedAccount[key] = deserializedAccount[key].toString(16);
                        }
                    }
                }

                return {
                    address: address.toBase58(),
                    type: accountName,
                    ...deserializedAccount,
                };
            } else if (accountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
                // if it is not a program account is a new token
                const decodedMintData: Mint = MintLayout.decode(accountInfo.data);
                const mintData: ParsedMint = {
                    mint: address.toBase58(),
                    mintAuthorityOption: decodedMintData.mintAuthorityOption,
                    mintAuthority: decodedMintData.mintAuthority?.toBase58() || '',
                    supply: decodedMintData.supply.toString(),
                    decimals: decodedMintData.decimals,
                    isInitialized: decodedMintData.isInitialized,
                    freezeAuthorityOption: decodedMintData.freezeAuthorityOption,
                    freezeAuthority: decodedMintData.freezeAuthority?.toBase58() || '',
                };
                await db.saveMint(mintData);
                await db.saveMeme(mintData);
            }
        } catch (error: any) {
            console.error('Error parsing account:', address.toBase58(), error.message);
            return;
        }

        return;
    }
    
    private async parseUsers(transaction: VersionedTransaction): Promise<User[]> {
        const parsedUsers: User[] = [];
    
        for (const accountKey of transaction.message.staticAccountKeys) {
            if (transaction.message.isAccountSigner(transaction.message.staticAccountKeys.indexOf(accountKey))) {
                try {
                    const { wealth, tokens } = await this.fetcher.getUserWealth(accountKey);
                    parsedUsers.push({
                        address: accountKey.toBase58(),
                        wealth,
                        tokens,
                    });
                } catch (error: any) {
                    console.error(`Error fetching user wealth for ${accountKey.toBase58()}: ${error.message}`);
                }
            }
        }

        return parsedUsers;
    }    
}
