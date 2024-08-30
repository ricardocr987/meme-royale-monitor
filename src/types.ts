import { PublicKey, VersionedMessage } from "@solana/web3.js";

export type JupQuote = {
    data: {
      [key: string]: TokenPrice;
    };
    timeTaken: number;
};

export type TokenPrice = {
    id: string;
    mintSymbol: string;
    vsToken: string;
    vsTokenSymbol: string;
    price: number;
};

export type Mint = {
    mintAuthorityOption: number;
    mintAuthority: PublicKey;
    supply: BigInt;
    decimals: number;
    isInitialized: boolean;
    freezeAuthorityOption: number;
    freezeAuthority: PublicKey;
};

export type ParsedMint = {
    mint: string;
    mintAuthorityOption: number;
    mintAuthority: string;
    supply: string;
    decimals: number;
    isInitialized: boolean;
    freezeAuthorityOption: number;
    freezeAuthority: string;
};

export type VersionedTransaction = {
    signatures: string[];
    message: VersionedMessage;
}

export type Event = {
    signature: string;
    type: string;
    timestamp: number;
    signers: string[];
    data: any;
    accounts: string[];
};

export type Account = {
    address: string;
    deserializedAccount: any | null;
};

export type TokenData = {
    mint: string;
    balance: string;
};

export type WealthData = {
    wealth: string;
    tokens: TokenData[];
};

export type User = WealthData & {
    address: string;
};

export type ParsedTransaction = {
    events: Event[];
    accounts: Account[];
    users: User[];
};
