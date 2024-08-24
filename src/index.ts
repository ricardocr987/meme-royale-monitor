import { PublicKey } from "@solana/web3.js";
import { config } from "./lib/config";
import { MemeRoyale } from "@memeroyale/memeroyale-sdk";
import { MEMEROYALE_PROGRAM_ID } from "./lib/constants";
import { Parser } from "./parser";
import { BorshCoder, Wallet } from "@coral-xyz/anchor";
import { Fetcher } from "./fetcher";

class MonitorService {
    async init() {
        try {
            const programId = new PublicKey(MEMEROYALE_PROGRAM_ID);
            const wallet = new Wallet(config.SOLANA_KEYPAIR);
            const sdk = new MemeRoyale(config.RPC, programId, wallet);
            const coder = new BorshCoder(sdk.program.idl);

            const parser = new Parser(coder);
            const fetcher = new Fetcher(parser);
            parser.setFetcher(fetcher);

            await fetcher.init();
        } catch (error: any) {
            throw new Error("Sever initialization failed: " + error.message);
        }
    }
}

const monitor = new MonitorService();
monitor.init();
