import { MEMEROYALE_PROGRAM_ID } from "./lib/constants";
import { Parser } from "./parser";
import { AccountListener } from "./accountListener";
import { db } from "./lib/db";
import { PublicKey, VersionedTransactionResponse } from "@solana/web3.js";
import { config } from "./lib/config";
import ky from "ky";
import { JupQuote, Mint, ParsedMint, TokenData, WealthData } from "./types";
import BigNumber from "bignumber.js";
import { SOL_DECIMALS, SOL_MINT } from "./lib/constants";
import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MintLayout } from "./lib/solana";

export class Fetcher {
    private parser!: Parser
    private accountListener!: AccountListener
    
    constructor(parser: Parser) {
        this.parser = parser;
        this.accountListener = new AccountListener(parser);
    }

    public async init() {
        this.accountListener.init(MEMEROYALE_PROGRAM_ID);
        await this.getTransactions(MEMEROYALE_PROGRAM_ID);
    }

    public async getTransactions(account: string) {
        const pubkey = new PublicKey(account);
        const BATCH_SIZE = 100;
        const DELAY_MS = 1000;
    
        let signaturesCounter = 0;
        let processedTransaction = 0;
        let lastSignature: string | undefined = undefined;    
        console.log(`Starting to fetch transactions for ${account}`);

        try {
            do {
                const signatures: string[] = await config.RPC.getSignaturesForAddress(pubkey, {
                    before: lastSignature,
                    limit: BATCH_SIZE,
                }).then(x => x.map(x => x.signature));
                signaturesCounter += signatures.length;
        
                if (signatures.length === 0) break;
                const filteredSignatures = await this.filterExistingSignatures(signatures);
                if (filteredSignatures.length === 0) break;
    
                const rawTransactions = await config.RPC.getTransactions(filteredSignatures, { 
                    maxSupportedTransactionVersion: 0, 
                    commitment: 'confirmed' 
                });
                const transactions = rawTransactions.filter((tx): tx is VersionedTransactionResponse => tx !== null);
                const parsedTransactions = await this.parser.parseTransactions(transactions);
                await db.saveParsedTransactions(parsedTransactions);
                processedTransaction += parsedTransactions.reduce((accumulator, x) => accumulator + x.events.length, 0);

                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
                lastSignature = signatures[signatures.length - 1];

                console.log('Transaction batch done');
            } while (true);
        } catch(e: any) {
            console.log(e.message)
        }

        console.log(`Finished fetching transactions for ${account}, signatures: ${signaturesCounter}, events: ${processedTransaction}`);
    }

    public async getUserWealth(userPublicKey: PublicKey): Promise<WealthData> {
        let totalWealth = new BigNumber(0);
        const tokens: TokenData[] = [];
    
        const [solBalance, solPriceData] = await Promise.all([
            config.RPC.getBalance(userPublicKey),
            this.getPrices([SOL_MINT]),
        ]);
    
        const solAmount = new BigNumber(solBalance).dividedBy(new BigNumber(10).pow(SOL_DECIMALS));
        if (solPriceData && solPriceData[SOL_MINT]) {
            const solValue = solAmount.multipliedBy(new BigNumber(solPriceData[SOL_MINT]));
            totalWealth = totalWealth.plus(solValue);
    
            tokens.push({
                mint: SOL_MINT,
                balance: solAmount.toString(),
            });
        }
    
        const tokenAccounts = await this.getTokenAccounts(userPublicKey.toBase58());
        const mintAddresses = tokenAccounts.map((x: any) => x.data.mint.toBase58());
    
        const [mints, prices] = await Promise.all([
            this.getMints(mintAddresses),
            this.getPrices(mintAddresses),
        ]);
    
        await Promise.all(tokenAccounts.map(async (accountData) => {
            const mint = accountData.data.mint.toBase58();
            const mintData = mints[mint];
            if (!mintData) return;
    
            const amount = new BigNumber(accountData.data.amount).dividedBy(
                new BigNumber(10).pow(mintData.decimals),
            );
    
            const price = prices[mint];
            if (!price) return;
    
            const tokenValue = amount.multipliedBy(new BigNumber(price));
            totalWealth = totalWealth.plus(tokenValue);
    
            tokens.push({
                mint,
                balance: amount.toString(16),
            });
        }));
    
        return {
            wealth: totalWealth.toString(16),
            tokens,
        };
    }
    
    private async filterExistingSignatures(signatures: string[]): Promise<string[]> {
        const filteredSignatures: string[] = [];
    
        await Promise.all(signatures.map(async (signature) => {
            const exists = await db.signatureExists(signature);
            if (!exists) filteredSignatures.push(signature);
        }));
        
        return filteredSignatures;
    }

    private async getTokenAccounts(userKey: string) {
        const publicKey = new PublicKey(userKey);
        const tokenAccounts = await config.RPC.getTokenAccountsByOwner(
            publicKey,
            { programId: TOKEN_PROGRAM_ID },
        );
      
        const accountDatas = tokenAccounts.value.map((account) => ({
            pubkey: account.pubkey.toBase58(),
            data: AccountLayout.decode(account.account.data),
        }));
      
        return accountDatas
            .map((x) => ({
                ...x,
                data: {
                    ...x.data,
                    amount: new BigNumber(x.data.amount.toString()),
                },
            }))
            .filter((x) => x.data.amount.isGreaterThan(0));
    }
    
    private async getMints(mintAddresses: string[]): Promise<Record<string, ParsedMint>> {
        const MAX_BATCH_SIZE = 100;
        const mints: Record<string, ParsedMint> = {};
        
        const batchedMintAddresses = [];
        for (let i = 0; i < mintAddresses.length; i += MAX_BATCH_SIZE) {
            batchedMintAddresses.push(mintAddresses.slice(i, i + MAX_BATCH_SIZE));
        }
        
        for (const batch of batchedMintAddresses) {
            const mintPublicKeys: PublicKey[] = [];
            const mintAddressesToFetch: string[] = [];
        
            for (const mintAddress of batch) {
                const cachedMint = await db.getMint(mintAddress);
                if (cachedMint) {
                    mints[mintAddress] = cachedMint;
                } else {
                    mintAddressesToFetch.push(mintAddress);
                    mintPublicKeys.push(new PublicKey(mintAddress));
                }
            }
        
            if (mintAddressesToFetch.length > 0) {
                const mintAccountInfos = await config.RPC.getMultipleAccountsInfo(mintPublicKeys);
        
                for (let idx = 0; idx < mintAccountInfos.length; idx++) {
                    const accountInfo = mintAccountInfos[idx];
                    if (accountInfo && accountInfo.data) {
                        const decodedMintData: Mint = MintLayout.decode(accountInfo.data);
                        const mintAddress = mintAddressesToFetch[idx];
                        const mintData: ParsedMint = {
                            mint: mintAddress,
                            mintAuthorityOption: decodedMintData.mintAuthorityOption,
                            mintAuthority: decodedMintData.mintAuthority?.toBase58() || '',
                            supply: decodedMintData.supply.toString(),
                            decimals: decodedMintData.decimals,
                            isInitialized: decodedMintData.isInitialized,
                            freezeAuthorityOption: decodedMintData.freezeAuthorityOption,
                            freezeAuthority: decodedMintData.freezeAuthority?.toBase58() || '',
                        };
                        mints[mintAddress] = mintData;
        
                        await db.saveMint(mintData);
                    }
                }
            }
        }
        
        return mints;
    }    
    
    private async getPrices(mintAddresses: string[]): Promise<Record<string, number>> {
        const vsToken = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
        const priceUrl = "https://price.jup.ag/v6/price";
        const pricesRecord: Record<string, number> = {};
    
        const createQueryString = (ids: string[]) => {
            const params = new URLSearchParams({ ids: ids.join(","), vsToken });
            return `${priceUrl}?${params.toString()}`;
        };
    
        const fetchSubsetPrices = async (subset: string[]) => {
            try {
                const response = await ky
                    .get(priceUrl, {
                        searchParams: {
                            ids: subset.join(","),
                            vsToken,
                        },
                        retry: {
                            limit: 5,
                            methods: ["get"],
                            delay: (attemptCount) => 0.3 * 2 ** (attemptCount - 1) * 1000,
                        },
                    })
                    .json<JupQuote>();
    
                for (const mint of subset) {
                    const price = response.data && response.data[mint] ? response.data[mint].price : null;
                    if (!price) continue;

                    pricesRecord[mint] = price;
                }
            } catch (error: any) {
                console.error(`Error fetching prices for subset: ${error.message}`);
            }
        };
    
        let subset: string[] = [];
        for (const mint of mintAddresses) {
            const tempSubset = [...subset, mint];
            if (createQueryString(tempSubset).length > 4000) {
                await fetchSubsetPrices(subset);
                subset = [mint];
            } else {
                subset = tempSubset;
            }
        }
    
        if (subset.length > 0) {
            await fetchSubsetPrices(subset);
        }
    
        return pricesRecord;
    }    
}