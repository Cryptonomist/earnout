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
    /// tags. Tags signed by any other identity are ignored off-chain. It is
    /// also the only voucher whose X links this campaign trusts.
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

/// "This wallet belongs to this X account", as one voucher sees it. Written
/// under two signatures: the wallet's, and the voucher's, which says X's own
/// sign-in confirmed the account to whoever held the browser. Neither alone
/// writes anything. A campaign trusts only the links its identity vouched
/// for, so there is no admin and nothing global to capture.
#[account]
#[derive(InitSpace)]
pub struct XLink {
    pub voucher: Pubkey,
    pub wallet: Pubkey,
    pub x_id: u64,
    #[max_len(15)]
    pub handle: String,
    pub linked_at: i64,
    pub bump: u8,
}

/// Which wallet an X account currently belongs to, per voucher. Linking the
/// same account from a new wallet re-points it, so one X account is one
/// identity, and a wallet the account has left can no longer stand for it.
#[account]
#[derive(InitSpace)]
pub struct XClaim {
    pub voucher: Pubkey,
    pub x_id: u64,
    pub wallet: Pubkey,
    pub bump: u8,
}

/// The X account a channel was created for. Written once, never changed:
/// the payout wallet can move, the person cannot, so a record follows them.
#[account]
#[derive(InitSpace)]
pub struct ChannelIdentity {
    pub channel: Pubkey,
    pub x_id: u64,
    #[max_len(15)]
    pub handle: String,
    pub bump: u8,
}
