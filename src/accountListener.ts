import { VersionedTransaction } from "@solana/web3.js";
import { db } from "./lib/db";
import { config } from "./lib/config";
import { Parser } from "./parser";
import { VersionedTransaction as Transaction } from "./types";

export class AccountListener {
    private ws: WebSocket = new WebSocket(`wss://atlas-mainnet.helius-rpc.com?api-key=${config.RPC_KEY}`);
    private parser!: Parser
    
    constructor(parser: Parser) {
        this.parser = parser;
    }
    
    public init(account: string) {
        this.ws.addEventListener("open", async () => {
            this.sendRequest(account);
            
            this.ws.addEventListener("message", async ({ data }: MessageEvent) => {
                await this.handleMessage(data);
            });
    
            this.ws.addEventListener("error", (error: any) => {
                console.error('WebSocket error:', error);
            });
    
            this.ws.addEventListener("close", ({ code, reason }: CloseEvent) => {
                console.log(`WebSocket closed: ${code} - ${reason}`);
                this.handleClose();
            });
        });
    }

    private async handleMessage(data: any) {
        try {
            const message = JSON.parse(data.toString());
            const { id, params } = message;

            if (id) console.log('WebSocket communication open');
            if (params) {
                console.log('New transaction:', params.result.transaction.meta);
    
                const baseTransaction = params.result.transaction.transaction[0];
                const transactionBuffer = Buffer.from(baseTransaction, 'base64');
                const transaction = VersionedTransaction.deserialize(transactionBuffer);
                const versionedTransaction: Transaction = {
                    signatures: transaction.signatures.map(x => x.toString()),
                    message: transaction.message
                };
                const meta = params.result.transaction.meta;
                const parsedTransaction = await this.parser.parseTransaction(versionedTransaction, meta);
                await db.saveParsedTransaction(parsedTransaction);
    
                console.log('Transaction registered:', transaction);
            }
        } catch (error) {
            console.error('Failed to process message:', error);
        }
    }

    private handleClose() {
        console.log('Attempting to reconnect...');
        setTimeout(() => {
            this.ws = new WebSocket(this.ws.url);
            this.init(this.ws.url.split('accountInclude=')[1]);
        }, 5000);
    }

    private sendRequest(account: string) {
        const request = {
            jsonrpc: "2.0",
            id: 420,
            method: "transactionSubscribe",
            params: [
                {
                    accountInclude: [account]
                },
                {
                    commitment: "confirmed",
                    encoding: "base64",
                    transactionDetails: "full",
                    showRewards: true,
                    maxSupportedTransactionVersion: 0
                }
            ]
        };
        this.ws.send(JSON.stringify(request));
    }
}