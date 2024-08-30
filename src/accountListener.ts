import { config } from "./lib/config";
import { Parser } from "./parser";
import { ParsedTransactionWithMeta } from "@solana/web3.js";

interface TransactionNotification {
    jsonrpc: "2.0";
    method: "transactionNotification";
    params: {
        subscription: number;
        result: ListenerMessage;
    };
}

export type ListenerMessage = {
    transaction: {
        transaction: [string, "base64"];
        meta: {
            err: null | any;
            status: { Ok: null } | { Err: any };
            fee: number;
            preBalances: number[];
            postBalances: number[];
            innerInstructions: any[];
            logMessages: string[];
            preTokenBalances: any[];
            postTokenBalances: any[];
            rewards: null | any;
            loadedAddresses: {
                writable: string[];
                readonly: string[];
            };
            computeUnitsConsumed: number;
        };
    };
    signature: string;
}

export class AccountListener {
    private ws: WebSocket;
    private parser: Parser;
    private account: string = "";
    private reconnectAttempts: number = 0;
    private readonly MAX_RECONNECT_ATTEMPTS: number = 5;
    private readonly RECONNECT_DELAY: number = 5000;

    constructor(parser: Parser) {
        this.parser = parser;
        this.ws = new WebSocket(`wss://atlas-mainnet.helius-rpc.com?api-key=${config.RPC_KEY}`);
    }

    public init(account: string): void {
        this.account = account;
        this.setupWebSocket();
    }

    private setupWebSocket(): void {
        this.ws.addEventListener("open", this.onOpen.bind(this));
        this.ws.addEventListener("message", this.onMessage.bind(this));
        this.ws.addEventListener("error", this.onError.bind(this));
        this.ws.addEventListener("close", this.onClose.bind(this));
    }

    private onOpen(): void {
        console.log("WebSocket connection established");
        this.sendRequest(this.account);
        this.reconnectAttempts = 0;
    }

    private async onMessage(event: MessageEvent): Promise<void> {
        try {
            const message: TransactionNotification = JSON.parse(event.data.toString());
            
            if (message.method === "transactionNotification") {
                const rawTransactions = await config.RPC.getBatchTransactions([message.params.result.signature]);
                const transactions = rawTransactions.filter((tx): tx is ParsedTransactionWithMeta => tx !== null);
                await this.parser.parseTransactions(transactions);
            }
        } catch (error) {
            console.error('Failed to process message:', error);
        }
    }

    private onError(error: Event): void {
        console.error('WebSocket error:', error);
    }

    private onClose(event: CloseEvent): void {
        console.log(`WebSocket closed: ${event.code} - ${event.reason}`);
        this.handleReconnect();
    }

    private handleReconnect(): void {
        if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
            console.log(`Attempting to reconnect... (Attempt ${this.reconnectAttempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);
            setTimeout(() => {
                this.reconnectAttempts++;
                this.ws = new WebSocket(`wss://atlas-mainnet.helius-rpc.com?api-key=${config.RPC_KEY}`);
                this.setupWebSocket();
            }, this.RECONNECT_DELAY);
        } else {
            console.error('Max reconnection attempts reached. Please check your connection and restart the application.');
        }
    }

    private sendRequest(account: string): void {
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