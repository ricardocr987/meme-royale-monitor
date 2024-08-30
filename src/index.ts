import { PublicKey } from "@solana/web3.js";
import { config } from "./lib/config";
import { MemeRoyale } from "@memeroyale/memeroyale-sdk";
import { MEMEROYALE_PROGRAM_ID } from "./lib/constants";
import { Parser } from "./parser";
import { BorshCoder, Wallet } from "@coral-xyz/anchor";
import { Fetcher } from "./fetcher";
import { Database } from "./lib/db";

class MonitorService {
    private parser: Parser;
    private fetcher: Fetcher;
    private db: Database;
  
    constructor() {
        const programId = new PublicKey(MEMEROYALE_PROGRAM_ID);
        const wallet = new Wallet(config.SOLANA_KEYPAIR);
        const sdk = new MemeRoyale(config.RPC, programId, wallet);
        const coder = new BorshCoder(sdk.program.idl);

        this.db = new Database();
        
        this.parser = new Parser(this.db, coder);
        this.fetcher = new Fetcher(this.db);
    
        Object.assign(this.parser, { fetcher: this.fetcher });
        Object.assign(this.fetcher, { parser: this.parser });
    }
    
    async init() {
        await this.fetcher.init();
    }
}

async function main() {
    try {
        const monitor = new MonitorService();
        await monitor.init();
    } catch (error) {
        console.error("Application failed:", error);
        process.exit(1);
    }
}

main();
