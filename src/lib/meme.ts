import { createHash } from 'crypto';

function sighash(namespace: string, name: string): Buffer {
    const preimage = `${namespace}:${name}`;
    const hash = createHash('sha256').update(preimage).digest();
    return hash.slice(0, 8);
}

export const accounts = [
    "Conversion",
    "Empty",
    "Global",
    "Index",
    "Permission",
    "Pool",
    "RaidProposal",
    "RaidProposalStake",
    "Referral",
    "User"
];

export const instructions = [
    "chainConversion",
    "claimProposalStakeOrReward",
    "claimReferral",
    "closeConversion",
    "closePool",
    "closeRaidProposal",
    "closeSuperAdminAndGlobalState",
    "convert",
    "graduate",
    "initializePool",
    "initializeReferral",
    "initializeSuperAdminAndGlobalState",
    "initializeUser",
    "initOrUpdateAdmin",
    "meteoraClaimFee",
    "meteoraClaimFeesAccts",
    "meteoraCreateEscrow",
    "meteoraLock",
    "meteoraLockLiquidity",
    "proposeRaidOrStake",
    "raydiumInitialize",
    "reallocGlobal",
    "reallocPool",
    "settleRaid",
    "sweepFees",
    "trade",
    "transferSuperAdmin",
    "transferToNative",
    "updateGlobalState",
    "updateReferralTerms",
    "updateUserTerms",
    "withdrawProposalStake"
];

export const accountDiscriminators: Record<string, string> = {};
export const instructionDiscriminators: Record<string, string> = {};

accounts.forEach(account => {
    const discriminator = sighash("account", account).toString('hex');
    accountDiscriminators[discriminator] = account;
});

instructions.forEach(instruction => {
    const discriminator = sighash("global", instruction).toString('hex');
    instructionDiscriminators[discriminator] = instruction;
});