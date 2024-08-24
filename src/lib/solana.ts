import { publicKey, struct, u32, u64, u8 } from "@coral-xyz/borsh";

export const MintLayout = struct([
    u32("mintAuthorityOption"),
    publicKey("mintAuthority"),
    u64("supply"),
    u8("decimals"),
    u8("isInitialized"),
    u32("freezeAuthorityOption"),
    publicKey("freezeAuthority"),
]);