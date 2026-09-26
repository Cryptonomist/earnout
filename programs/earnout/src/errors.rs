use anchor_lang::prelude::*;

#[error_code]
pub enum EarnoutError {
    #[msg("The payout per conversion must be more than zero")]
    ZeroPayout,
    #[msg("The retention window is longer than 180 days")]
    RetentionTooLong,
    #[msg("The campaign must end in the future")]
    EndsInPast,
    #[msg("The settle deadline must leave at least an hour after the last retention window")]
    DeadlineTooSoon,
    #[msg("The amount must be more than zero")]
    ZeroAmount,
    #[msg("This campaign has ended")]
    CampaignEnded,
    #[msg("The settle deadline has passed")]
    SettlementClosed,
    #[msg("That is not this channel's next batch")]
    WrongBatch,
    #[msg("A settlement must carry at least one conversion")]
    NoConversions,
    #[msg("The campaign budget cannot cover this settlement")]
    OverBudget,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Refunds open after the settle deadline")]
    TooEarlyToRefund,
    #[msg("Nothing to refund")]
    NothingToRefund,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("The vault received less than was sent")]
    ShortTransfer,
    #[msg("An X account id cannot be zero")]
    BadXId,
    #[msg("An X handle is 1 to 15 letters, digits or underscores")]
    BadHandle,
    #[msg("That X account now belongs to a different wallet")]
    XAccountMoved,
    #[msg("Payouts can only move to a wallet linked to the same X account")]
    DifferentPerson,
}
