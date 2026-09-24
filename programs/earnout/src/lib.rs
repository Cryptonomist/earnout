#![allow(clippy::too_many_arguments)]
#![allow(unexpected_cfgs)]

//! # Earnout
//!
//! Marketing budgets that pay out only for users who stay.
//!
//! An advertiser funds a campaign with a token (USDC in practice) and sets a
//! price per conversion, a retention window, and the channels that send
//! users: creators, newsletters, partner apps. Each channel's link carries a
//! single-use reference signed by the campaign's Action Identity, and the
//! transaction a user makes through it carries that reference the way the
//! Solana Actions spec lays out: as a read-only key on `tag`, and in a
//! `solana-action:<identity>:<reference>:<signature>` memo. Only the first
//! transaction to use a reference counts.
//!
//! ## Who decides what counts
//!
//! The settler, a key named on the campaign. After a converted wallet's
//! retention window has passed, it checks the wallet is still there and not
//! part of an obvious sybil cluster, then records the channel's qualified
//! conversions as a numbered batch with a Merkle root of the evidence. The
//! program does not re-read the chain; it holds the settler to what it can
//! check:
//!
//! * a batch pays exactly `conversions * payout`, and never more than the
//!   campaign has left uncommitted;
//! * batches are numbered per channel, so one batch cannot be recorded twice;
//! * nothing is recorded after the settle deadline.
//!
//! Every conversion in a batch's evidence names a transaction the advertiser
//! can look up, so a settler that overcounts can be caught, though not
//! stopped. To everyone else the channels stay private: a reference is
//! ciphertext only the campaign's key can read, so the chain shows that a
//! wallet converted, not who sent it.
//!
//! ## Where the budget can go
//!
//! The vault is the campaign's associated token account. Tokens leave it by
//! exactly two paths, each of which names its own recipient:
//!
//! * `claim`: a channel's payee takes what settlements have committed to it,
//!   at any time, including after the deadline;
//! * `refund`: once the settle deadline has passed, the advertiser takes
//!   back everything never committed.
//!
//! There is no admin, no fee and no sweep. The settler can commit budget to
//! channels the advertiser added, and do nothing else.
//!
//! ## A tag never fails
//!
//! `tag` reads nothing and writes nothing. It rides inside somebody else's
//! transaction (a deposit, a swap, a mint), and a tag that could fail would
//! let a stale link break a user's purchase. Whether a tag is genuine is
//! decided off-chain from the memo's signature, as the spec intends.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

pub mod constants;
pub mod errors;
pub mod events;
pub mod state;

use constants::*;
use errors::EarnoutError;
use events::*;
use state::*;

declare_id!("EKcSH6aEQiKhULjqixHqaReodxh61tMKRZ8Vsg4Vz8dU");

#[program]
pub mod earnout {
    use super::*;

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        seed: u64,
        payout: u64,
        retention_secs: u32,
        ends_at: i64,
        settle_deadline: i64,
        settler: Pubkey,
        identity: Pubkey,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(payout > 0, EarnoutError::ZeroPayout);
        require!(
            retention_secs <= MAX_RETENTION_SECS,
            EarnoutError::RetentionTooLong
        );
        require!(ends_at > now, EarnoutError::EndsInPast);
        let earliest_deadline = ends_at
            .checked_add(retention_secs as i64)
            .and_then(|t| t.checked_add(MIN_SETTLE_GRACE))
            .ok_or(EarnoutError::MathOverflow)?;
        require!(
            settle_deadline >= earliest_deadline,
            EarnoutError::DeadlineTooSoon
        );

        let c = &mut ctx.accounts.campaign;
        c.advertiser = ctx.accounts.advertiser.key();
        c.seed = seed;
        c.mint = ctx.accounts.mint.key();
        c.settler = settler;
        c.identity = identity;
        c.payout = payout;
        c.retention_secs = retention_secs;
        c.created_at = now;
        c.ends_at = ends_at;
        c.settle_deadline = settle_deadline;
        c.bump = ctx.bumps.campaign;

        emit!(CampaignCreated {
            campaign: c.key(),
            advertiser: c.advertiser,
            mint: c.mint,
            settler,
            identity,
            payout,
            retention_secs,
            ends_at,
            settle_deadline,
        });
        Ok(())
    }

    /// Add to the budget. Anyone can, until the settle deadline; a top-up
    /// after the campaign ends lets the settler pay conversions still in
    /// their retention window.
    pub fn fund(ctx: Context<Fund>, amount: u64) -> Result<()> {
        require!(amount > 0, EarnoutError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        require!(
            now <= ctx.accounts.campaign.settle_deadline,
            EarnoutError::SettlementClosed
        );

        /* The check is on the vault's balance delta, so a fee-on-transfer mint
         * makes funding fail rather than leaving `funded` above what the
         * vault can pay. */
        let before = ctx.accounts.vault.amount;
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.vault.reload()?;
        let received = ctx
            .accounts
            .vault
            .amount
            .checked_sub(before)
            .ok_or(EarnoutError::MathOverflow)?;
        require!(received == amount, EarnoutError::ShortTransfer);

        let c = &mut ctx.accounts.campaign;
        c.funded = c
            .funded
            .checked_add(amount)
            .ok_or(EarnoutError::MathOverflow)?;
        emit!(Funded {
            campaign: c.key(),
            funder: ctx.accounts.funder.key(),
            amount,
            funded: c.funded,
        });
        Ok(())
    }

    pub fn add_channel(ctx: Context<AddChannel>, payee: Pubkey) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.campaign;
        require!(now < c.ends_at, EarnoutError::CampaignEnded);
        let index = c.channels;
        c.channels = index.checked_add(1).ok_or(EarnoutError::MathOverflow)?;

        let ch = &mut ctx.accounts.channel;
        ch.campaign = c.key();
        ch.index = index;
        ch.payee = payee;
        ch.bump = ctx.bumps.channel;

        emit!(ChannelAdded {
            campaign: ch.campaign,
            channel: ch.key(),
            index,
            payee,
        });
        Ok(())
    }

    /// A payee can move its earnings to a new wallet, including what is
    /// already committed but unclaimed.
    pub fn set_payee(ctx: Context<SetPayee>, new_payee: Pubkey) -> Result<()> {
        let ch = &mut ctx.accounts.channel;
        let old = ch.payee;
        ch.payee = new_payee;
        emit!(PayeeChanged {
            channel: ch.key(),
            old,
            new: new_payee,
        });
        Ok(())
    }

    pub fn settle(
        ctx: Context<Settle>,
        batch: u32,
        conversions: u32,
        evidence: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.campaign;
        let ch = &mut ctx.accounts.channel;
        require!(now <= c.settle_deadline, EarnoutError::SettlementClosed);
        require!(conversions > 0, EarnoutError::NoConversions);
        require!(batch == ch.batches, EarnoutError::WrongBatch);

        let amount = c
            .payout
            .checked_mul(conversions as u64)
            .ok_or(EarnoutError::MathOverflow)?;
        let committed = c
            .committed
            .checked_add(amount)
            .ok_or(EarnoutError::MathOverflow)?;
        require!(committed <= c.funded, EarnoutError::OverBudget);
        c.committed = committed;

        ch.batches = batch.checked_add(1).ok_or(EarnoutError::MathOverflow)?;
        ch.conversions = ch
            .conversions
            .checked_add(conversions as u64)
            .ok_or(EarnoutError::MathOverflow)?;
        ch.earned = ch
            .earned
            .checked_add(amount)
            .ok_or(EarnoutError::MathOverflow)?;
        ch.evidence = evidence;

        emit!(Settled {
            campaign: c.key(),
            channel: ch.key(),
            batch,
            conversions,
            amount,
            evidence,
        });
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let ch = &ctx.accounts.channel;
        let amount = ch
            .earned
            .checked_sub(ch.claimed)
            .ok_or(EarnoutError::MathOverflow)?;
        require!(amount > 0, EarnoutError::NothingToClaim);

        pay_out(
            &ctx.accounts.token_program,
            &ctx.accounts.mint,
            &ctx.accounts.vault,
            ctx.accounts.payee_account.to_account_info(),
            &ctx.accounts.campaign,
            amount,
        )?;

        let ch = &mut ctx.accounts.channel;
        ch.claimed = ch
            .claimed
            .checked_add(amount)
            .ok_or(EarnoutError::MathOverflow)?;
        let c = &mut ctx.accounts.campaign;
        c.claimed = c
            .claimed
            .checked_add(amount)
            .ok_or(EarnoutError::MathOverflow)?;

        emit!(Claimed {
            campaign: c.key(),
            channel: ch.key(),
            payee: ch.payee,
            amount,
        });
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &ctx.accounts.campaign;
        require!(now > c.settle_deadline, EarnoutError::TooEarlyToRefund);
        let amount = c
            .funded
            .checked_sub(c.committed)
            .and_then(|a| a.checked_sub(c.refunded))
            .ok_or(EarnoutError::MathOverflow)?;
        require!(amount > 0, EarnoutError::NothingToRefund);

        pay_out(
            &ctx.accounts.token_program,
            &ctx.accounts.mint,
            &ctx.accounts.vault,
            ctx.accounts.advertiser_account.to_account_info(),
            &ctx.accounts.campaign,
            amount,
        )?;

        let c = &mut ctx.accounts.campaign;
        c.refunded = c
            .refunded
            .checked_add(amount)
            .ok_or(EarnoutError::MathOverflow)?;
        emit!(Refunded {
            campaign: c.key(),
            advertiser: c.advertiser,
            amount,
        });
        Ok(())
    }

    /// Marks the transaction it rides in as coming through a campaign link.
    /// See "A tag never fails" above.
    pub fn tag(_ctx: Context<Tag>) -> Result<()> {
        Ok(())
    }
}

/// Send `amount` from the vault, signed for by the campaign PDA.
fn pay_out<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    to: AccountInfo<'info>,
    campaign: &Account<'info, Campaign>,
    amount: u64,
) -> Result<()> {
    let advertiser = campaign.advertiser;
    let seed = campaign.seed.to_le_bytes();
    let bump = [campaign.bump];
    let seeds: &[&[u8]] = &[SEED_CAMPAIGN, advertiser.as_ref(), &seed, &bump];
    transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to,
                authority: campaign.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub advertiser: Signer<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = advertiser,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [SEED_CAMPAIGN, advertiser.key().as_ref(), &seed.to_le_bytes()],
        bump
    )]
    pub campaign: Box<Account<'info, Campaign>>,
    /* The vault IS the campaign's associated token account: derived, never
     * passed in. `init_if_needed` rather than `init` because anybody can
     * create an ATA for any owner, and a stranger who made this one first
     * would otherwise block the campaign. */
    #[account(
        init_if_needed,
        payer = advertiser,
        associated_token::mint = mint,
        associated_token::authority = campaign,
        associated_token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    pub funder: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_CAMPAIGN, campaign.advertiser.as_ref(), &campaign.seed.to_le_bytes()],
        bump = campaign.bump,
        has_one = mint
    )]
    pub campaign: Box<Account<'info, Campaign>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = campaign,
        associated_token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = funder,
        token::token_program = token_program
    )]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct AddChannel<'info> {
    #[account(mut)]
    pub advertiser: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_CAMPAIGN, advertiser.key().as_ref(), &campaign.seed.to_le_bytes()],
        bump = campaign.bump,
        has_one = advertiser
    )]
    pub campaign: Box<Account<'info, Campaign>>,
    #[account(
        init,
        payer = advertiser,
        space = 8 + Channel::INIT_SPACE,
        seeds = [SEED_CHANNEL, campaign.key().as_ref(), &campaign.channels.to_le_bytes()],
        bump
    )]
    pub channel: Box<Account<'info, Channel>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPayee<'info> {
    pub payee: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_CHANNEL, channel.campaign.as_ref(), &channel.index.to_le_bytes()],
        bump = channel.bump,
        has_one = payee
    )]
    pub channel: Box<Account<'info, Channel>>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    pub settler: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_CAMPAIGN, campaign.advertiser.as_ref(), &campaign.seed.to_le_bytes()],
        bump = campaign.bump,
        has_one = settler
    )]
    pub campaign: Box<Account<'info, Campaign>>,
    #[account(
        mut,
        seeds = [SEED_CHANNEL, campaign.key().as_ref(), &channel.index.to_le_bytes()],
        bump = channel.bump,
        has_one = campaign
    )]
    pub channel: Box<Account<'info, Channel>>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub payee: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_CAMPAIGN, campaign.advertiser.as_ref(), &campaign.seed.to_le_bytes()],
        bump = campaign.bump,
        has_one = mint
    )]
    pub campaign: Box<Account<'info, Campaign>>,
    #[account(
        mut,
        seeds = [SEED_CHANNEL, campaign.key().as_ref(), &channel.index.to_le_bytes()],
        bump = channel.bump,
        has_one = campaign,
        has_one = payee
    )]
    pub channel: Box<Account<'info, Channel>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = campaign,
        associated_token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payee,
        associated_token::mint = mint,
        associated_token::authority = payee,
        associated_token::token_program = token_program
    )]
    pub payee_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub advertiser: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_CAMPAIGN, advertiser.key().as_ref(), &campaign.seed.to_le_bytes()],
        bump = campaign.bump,
        has_one = advertiser,
        has_one = mint
    )]
    pub campaign: Box<Account<'info, Campaign>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = campaign,
        associated_token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = advertiser,
        associated_token::mint = mint,
        associated_token::authority = advertiser,
        associated_token::token_program = token_program
    )]
    pub advertiser_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Three read-only keys, none of them checked. They are here so the
/// transaction can be found by address: by campaign, by identity (as the
/// Actions spec asks indexers to look), and by reference (to prove this was
/// the reference's first use).
#[derive(Accounts)]
pub struct Tag<'info> {
    /// CHECK: never read; indexed by address only.
    pub campaign: UncheckedAccount<'info>,
    /// CHECK: never read; the memo's signature is what proves the identity.
    pub identity: UncheckedAccount<'info>,
    /// CHECK: never read; any 32 bytes, used once.
    pub reference: UncheckedAccount<'info>,
}
