use anchor_lang::prelude::*;

#[event]
pub struct CampaignCreated {
    pub campaign: Pubkey,
    pub advertiser: Pubkey,
    pub mint: Pubkey,
    pub settler: Pubkey,
    pub identity: Pubkey,
    pub payout: u64,
    pub retention_secs: u32,
    pub ends_at: i64,
    pub settle_deadline: i64,
}

#[event]
pub struct Funded {
    pub campaign: Pubkey,
    pub funder: Pubkey,
    pub amount: u64,
    pub funded: u64,
}

#[event]
pub struct ChannelAdded {
    pub campaign: Pubkey,
    pub channel: Pubkey,
    pub index: u32,
    pub payee: Pubkey,
}

#[event]
pub struct PayeeChanged {
    pub channel: Pubkey,
    pub old: Pubkey,
    pub new: Pubkey,
}

#[event]
pub struct Settled {
    pub campaign: Pubkey,
    pub channel: Pubkey,
    pub batch: u32,
    pub conversions: u32,
    pub amount: u64,
    pub evidence: [u8; 32],
}

#[event]
pub struct Claimed {
    pub campaign: Pubkey,
    pub channel: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Refunded {
    pub campaign: Pubkey,
    pub advertiser: Pubkey,
    pub amount: u64,
}
