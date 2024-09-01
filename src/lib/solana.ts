import { publicKey, struct, u32, u64, u8 } from "@coral-xyz/borsh";
import { PublicKey, Connection, ParsedTransactionWithMeta, ConfirmedSignatureInfo } from "@solana/web3.js";
import { SparseRateLimit, AccurateRateLimit, ConcurrenceRateLimit, ComposeRateLimit, RateLimitClient } from "./rateLimit";
import CacheableLookup from "cacheable-lookup";
import http, { AgentOptions } from "http";
import https from "https";
import ky from "ky";
import { config } from './config';

export const MintLayout = struct([
    u32("mintAuthorityOption"),
    publicKey("mintAuthority"),
    u64("supply"),
    u8("decimals"),
    u8("isInitialized"),
    u32("freezeAuthorityOption"),
    publicKey("freezeAuthority"),
]);

export class SolanaClient extends Connection {
    private readonly MAX_RETRIES = 5;
    private readonly INITIAL_BACKOFF = 1000;
    private readonly ky: typeof ky;
    private readonly rateLimitClient: RateLimitClient;
    public endpoint: string;

    constructor(endpoint: string) {
        const cacheable = new CacheableLookup();
        const options: AgentOptions = {
            keepAlive: true,
            maxSockets: Infinity,
        };
        const agent = endpoint.indexOf("https://") !== -1
            ? new https.Agent(options)
            : new http.Agent(options);

        cacheable.install(agent);

        super(endpoint);

        this.endpoint = endpoint;

        this.ky = ky.create({
            retry: {
                limit: this.MAX_RETRIES,
                methods: ['post'],
                statusCodes: [408, 413, 429, 500, 502, 503, 504],
                backoffLimit: 15000,
                delay: (attemptCount) => this.INITIAL_BACKOFF * Math.pow(2, attemptCount - 1),
            },
            timeout: 30000,
        });

        this.rateLimitClient = new RateLimitClient(new ComposeRateLimit([
            new SparseRateLimit({ interval: 1000 * (10 + 1), limit: 10 }),
            new AccurateRateLimit({ interval: 1000 * (10 + 1), limit: 10 }),
            new ConcurrenceRateLimit({ maxConcurrency: 40 }),
        ]));

        setInterval(() => {
            const freeSockets = Object.keys(agent.freeSockets).length;
            const sockets = Object.keys(agent.sockets).length;
            const requests = Object.keys(agent.requests).length;

            if (freeSockets > 100 || sockets > 100 || requests > 100) {
                console.log(`
                    agent [${endpoint}]: {
                        freeSockets: ${freeSockets},
                        sockets: ${sockets},
                        requests: ${requests},
                    }
                `);
            }
        }, 1000 * 10);
    }

    async getSignatures(
        address: PublicKey,
        options?: any
    ): Promise<ConfirmedSignatureInfo[]> {
      return await this.rpcRequest<ConfirmedSignatureInfo[]>({
          method: 'getSignaturesForAddress',
          params: [
              address.toBase58(),
              {
                  commitment: 'finalized',
                  encoding: 'jsonParsed',
                  maxSupportedTransactionVersion: 0,
                  ...options,
              },
          ],
      });
    }

    private async rpcRequest<T>(payload: { method: string; params: any[] }): Promise<T> {
        const release = await this.rateLimitClient.acquire();

        try {
            if (payload.method === 'getTransaction') {
                const batch = payload.params[0].map((item: any) => ({
                    methodName: payload.method,
                    args: [item, payload.params[1]],
                }));

                const response = await (config.RPC as any)._rpcBatchRequest(batch);
                return response.map((x: any) => x.result);
            }

            const response = await this.ky.post(this.endpoint, {
                json: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: payload.method,
                    params: payload.params,
                },
            });

            const data = await response.json() as any;

            return data.result as T;
        } catch (error: any) {
            console.error('RPC Request failed:', error.message);
            console.error('Request details:', JSON.stringify(payload, null, 2));
            throw error;
        } finally {
            release();
        }
    }

    async getBatchTransactions(
        signatures: string[],
    ): Promise<(ParsedTransactionWithMeta | null)[]> {
        try {
            return await this.rpcRequest<ParsedTransactionWithMeta[]>({
                method: 'getTransaction',
                params: [signatures, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
            });
        } catch (error) {
            console.error('getBatchTransactions error:', error);
            throw error;
        }
    }

    async getConfirmation(
        signature: string,
        maxRetries: number = 10,
        retryDelay: number = 2000
    ): Promise<string | null> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const result = await this.getSignatureStatus(signature, {
                searchTransactionHistory: true,
            });
            const status = result.value?.confirmationStatus;
        
            if (status === 'confirmed' || status === 'finalized') {
                return status;
            }
        
            console.log(`Attempt ${attempt + 1}: Transaction not yet confirmed. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      
        console.error(`Transaction not confirmed after ${maxRetries} attempts.`);
        return null;
    }
}
