use anchor_lang::prelude::*;

/// One advertiser's budget for one goal, held in the campaign's associated
/// token account.
///
/// Money only moves three ways, and the counters below say how much of the
/// budget each has taken: `committed` by settlements (owed to channels, of
/// which `claimed` has left), and `refunded` back to the advertiser. The vault
/// always holds at least `funded - claimed - refunded`, and
/// `committed + refunded <= funded`.
#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub advertiser: Pubkey,
    /// Chosen by the advertiser; lets one advertiser run many campaigns.
    pub seed: u64,
    pub mint: Pubkey,
    /// The only key that can record qualified conversions.
    pub settler: Pubkey,
    /// The Action Identity whose signed references count as this campaign's
    /// tags. Tags signed by any other identity are ignored off-chain.
    pub identity: Pubkey,
    /// Paid per qualified conversion, in the mint's base units.
    pub payout: u64,
    /// How long a converted wallet must stay before it qualifies. Enforced by
    /// the settler; recorded here so anyone can hold it to it.
    pub retention_secs: u32,
    pub created_at: i64,
    /// Conversions after this time do not count.
    pub ends_at: i64,
    /// Settlements are accepted until this time; refunds only after it.
    pub settle_deadline: i64,
    pub funded: u64,
    pub committed: u64,
    pub claimed: u64,
    pub refunded: u64,
    /// How many channels have been added; the next channel's index.
    pub channels: u32,
    pub bump: u8,
}

/// Somebody who sends users: a creator, a newsletter, a partner app. Paid for
/// conversions the settler has qualified, and nothing else.
#[account]
#[derive(InitSpace)]
pub struct Channel {
    pub campaign: Pubkey,
    pub index: u32,
    /// The wallet that can claim what this channel has earned.
    pub payee: Pubkey,
    /// Settlements so far, which is also the number the next one must carry.
    pub batches: u32,
    pub conversions: u64,
    pub earned: u64,
    pub claimed: u64,
    /// Merkle root of the conversions in the latest batch. The full list goes
    /// to the advertiser, who can check every entry against the chain.
    pub evidence: [u8; 32],
    pub bump: u8,
}
