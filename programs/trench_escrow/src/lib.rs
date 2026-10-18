//! TrenchMart per-order SOL escrow.
//!
//! One `Escrow` PDA per order, at `["escrow", order_id]`. The buyer creates and funds it in
//! one transaction; after `escrow_until` anyone may crank `release`, which pays the seller the
//! price and the four fee buckets their split of the net fee. Inside the window the buyer can
//! `open_dispute`, which freezes the funds until the resolver either `refund`s the buyer or
//! `reject_dispute`s back to the prior state.
//!
//! # Invariants (each one is exercised in `tests/escrow.rs`)
//!
//! 1. **Funds only leave to stored parties.** Lamports leave an escrow only in `release`
//!    (to `seller` and the four buckets, each pinned by an `address = escrow.<field>`
//!    constraint) or `refund` (to `buyer`, pinned the same way). No instruction takes a
//!    destination from its arguments, and no instruction pays the resolver.
//! 2. **Exactly the deposit moves, never the rent.** `fund` moves `quote().total` in;
//!    `release` moves `price + net_fee == total` out; `refund` moves `deposit` out. The
//!    rent-exempt floor paid at `initialize` stays behind (see finding L-01: never reclaimed).
//! 3. **One terminal exit per escrow.** The state machine in `state.rs` has no edge out of
//!    `Refunded` or `Expired`, and `release` runs only from `Paid`, so funds leave at most once.
//! 4. **Time gates.** `fund` only until `expires_at`; `release` only from `escrow_until`;
//!    a `Paid` escrow can be disputed only before `escrow_until`; `expire` only after
//!    `expires_at` and only for an unfunded (`Pending`) escrow.
//! 5. **Authority.** `fund` and `open_dispute` need the stored buyer's signature
//!    (`has_one = buyer` + `Signer`); `refund` and `reject_dispute` need the stored resolver's.
//!    `release` and `expire` are permissionless by design: they can only follow the stored terms.
//! 6. **Account authenticity.** `Account<Escrow>` checks the owner (this program) and the
//!    8-byte discriminator, so look-alike accounts are rejected. `init` with canonical-bump
//!    seeds makes re-initialization impossible and binds the address to `order_id`.
//! 7. **Checked math.** Fee math is `u128` multiply then divide, floor rounding, dust to ops
//!    (`fee.rs`); every lamport add/sub is checked; `overflow-checks = true` in release.
//!
//! # Trust boundary
//!
//! `initialize` stores whatever terms the buyer signs: seller, resolver, buckets, fees, split
//! and times. The program does not know the marketplace's real fee or resolver. The API must
//! treat an escrow as payment for an order only after comparing every stored field with the
//! terms it issued (`escrowMismatch` in `apps/api/src/escrow.ts`). See
//! `docs/security/escrow-review.md`.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

mod fee;
mod state;

use fee::{quote, split_fee, FeeError};
use state::Status;

declare_id!("Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw");

// Lets wallets, explorers and security tools (Phantom, Blowfish, Solscan) identify the
// program and its owner. https://github.com/neodyme-labs/solana-security-txt
#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "TrenchMart Escrow",
    project_url: "https://trenchmart.fun",
    contacts: "link:https://github.com/Milerius/trenchmart/security/advisories/new",
    policy: "https://github.com/Milerius/trenchmart/security/policy",
    preferred_languages: "en",
    source_code: "https://github.com/Milerius/trenchmart",
    auditors: "None"
}

#[program]
pub mod trench_escrow {
    use super::*;

    /// Creates the order's escrow PDA and records its terms. Pays only rent; moves no price.
    ///
    /// Checks: `fee_bps`, `rebate_bps` <= 10_000; the four split parts sum to exactly 10_000
    /// (summed in `u32`, so wrapping values cannot fake it); the total `price + fee - rebate`
    /// fits in `u64`. The PDA seeds bind the account to `order_id`, and `init` fails if the
    /// account already exists, so terms can never be rewritten.
    ///
    /// Not checked (finding L-04): `expires_at`/`escrow_until` ordering, or that recipients
    /// differ from the buyer or the escrow itself. The API is the source of these values and
    /// verifies them after funding.
    pub fn initialize(
        ctx: Context<Initialize>,
        order_id: [u8; 16],
        args: InitializeArgs,
    ) -> Result<()> {
        require!(
            args.fee_bps <= 10_000 && args.rebate_bps <= 10_000,
            EscrowError::BadBps
        );
        let bps = [
            args.split_buyback_bps,
            args.split_ai_bps,
            args.split_ops_bps,
            args.split_safety_bps,
        ];
        let sum = u32::from(bps[0]) + u32::from(bps[1]) + u32::from(bps[2]) + u32::from(bps[3]);
        require!(sum == 10_000, EscrowError::BadSplit);
        let _ = quote(args.price, args.fee_bps, args.rebate_bps).map_err(map_fee)?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = args.seller;
        escrow.resolver = args.resolver;
        escrow.buyback = args.buyback;
        escrow.ai_verification = args.ai_verification;
        escrow.ops = args.ops;
        escrow.safety = args.safety;
        escrow.status = EscrowStatus::Pending;
        escrow.disputed_from = EscrowStatus::Pending;
        escrow.price = args.price;
        escrow.deposit = 0;
        escrow.fee_bps = args.fee_bps;
        escrow.rebate_bps = args.rebate_bps;
        escrow.split_buyback_bps = args.split_buyback_bps;
        escrow.split_ai_bps = args.split_ai_bps;
        escrow.split_ops_bps = args.split_ops_bps;
        escrow.split_safety_bps = args.split_safety_bps;
        escrow.expires_at = args.expires_at;
        escrow.escrow_until = args.escrow_until;
        escrow.bump = ctx.bumps.escrow;
        escrow.order_id = order_id;
        Ok(())
    }

    /// Moves exactly `total = price + fee - rebate` from the buyer into the escrow.
    ///
    /// Checks: status `Pending` (so it runs once), signer is the stored buyer, `now <=
    /// expires_at`, total > 0. The amount is recomputed from stored terms, never passed in.
    pub fn fund(ctx: Context<Fund>) -> Result<()> {
        transition(ctx.accounts.escrow.status, EscrowStatus::Paid)?;
        let now = Clock::get()?.unix_timestamp;
        require!(now <= ctx.accounts.escrow.expires_at, EscrowError::Expired);
        let quoted = quote(
            ctx.accounts.escrow.price,
            ctx.accounts.escrow.fee_bps,
            ctx.accounts.escrow.rebate_bps,
        )
        .map_err(map_fee)?;
        require!(quoted.total > 0, EscrowError::BadAmount);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            quoted.total,
        )?;
        let escrow = &mut ctx.accounts.escrow;
        escrow.deposit = quoted.total;
        escrow.status = EscrowStatus::Paid;
        Ok(())
    }

    /// Pays the seller `price` and each bucket its share of `net_fee`. Permissionless.
    ///
    /// Checks: status is exactly `Paid` (not `Disputed`), `now >= escrow_until`, and
    /// `deposit == total` (a defensive re-check of the amount `fund` stored). Every recipient
    /// account is pinned to the stored pubkey by an `address` constraint, so a cranker
    /// chooses nothing. The lamports `released` add up to `deposit`; the rent stays.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        // Release is permissionless after the window, so it must only ever move funds out of
        // Paid. A Disputed escrow leaves only through the resolver (refund or reject_dispute);
        // the generic Disputed -> Released edge exists for reject_dispute on a released order.
        require!(
            ctx.accounts.escrow.status == EscrowStatus::Paid,
            EscrowError::IllegalTransition
        );
        transition(ctx.accounts.escrow.status, EscrowStatus::Released)?;
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.escrow.escrow_until,
            EscrowError::TooEarly
        );
        let quoted = quote(
            ctx.accounts.escrow.price,
            ctx.accounts.escrow.fee_bps,
            ctx.accounts.escrow.rebate_bps,
        )
        .map_err(map_fee)?;
        let split = split_fee(
            quoted.net_fee,
            [
                ctx.accounts.escrow.split_buyback_bps,
                ctx.accounts.escrow.split_ai_bps,
                ctx.accounts.escrow.split_ops_bps,
                ctx.accounts.escrow.split_safety_bps,
            ],
        )
        .map_err(map_fee)?;
        require!(
            ctx.accounts.escrow.deposit == quoted.total,
            EscrowError::BadAmount
        );
        let escrow_info = ctx.accounts.escrow.to_account_info();
        move_lamports(
            &escrow_info,
            &ctx.accounts.seller.to_account_info(),
            quoted.price,
        )?;
        move_lamports(
            &escrow_info,
            &ctx.accounts.buyback.to_account_info(),
            split.buyback,
        )?;
        move_lamports(
            &escrow_info,
            &ctx.accounts.ai_verification.to_account_info(),
            split.ai_verification,
        )?;
        move_lamports(&escrow_info, &ctx.accounts.ops.to_account_info(), split.ops)?;
        move_lamports(
            &escrow_info,
            &ctx.accounts.safety.to_account_info(),
            split.safety,
        )?;
        ctx.accounts.escrow.status = EscrowStatus::Released;
        Ok(())
    }

    /// Marks an unfunded escrow as expired after `expires_at`. Permissionless; moves nothing.
    ///
    /// Only `Pending -> Expired` exists, so a funded escrow can never be expired out from
    /// under the buyer or the seller.
    pub fn expire(ctx: Context<Expire>) -> Result<()> {
        transition(ctx.accounts.escrow.status, EscrowStatus::Expired)?;
        let now = Clock::get()?.unix_timestamp;
        require!(now > ctx.accounts.escrow.expires_at, EscrowError::TooEarly);
        ctx.accounts.escrow.status = EscrowStatus::Expired;
        Ok(())
    }

    /// Buyer freezes the escrow. Moves nothing.
    ///
    /// From `Paid`: only while `now < escrow_until` (the error is `TooEarly`, which here means
    /// "too late"; finding I-04). From `Released`: allowed at any time, as a record only; the
    /// funds are gone and `refund` refuses (`FundsAlreadyReleased`). `disputed_from` remembers
    /// the origin so `reject_dispute` returns to it.
    ///
    /// Only the buyer can open a dispute. An off-chain dispute the buyer never signs on chain
    /// does not stop a permissionless `release` after the window (finding M-01).
    pub fn open_dispute(ctx: Context<OpenDispute>) -> Result<()> {
        let from = ctx.accounts.escrow.status;
        transition(from, EscrowStatus::Disputed)?;
        if from == EscrowStatus::Paid {
            let now = Clock::get()?.unix_timestamp;
            require!(
                now < ctx.accounts.escrow.escrow_until,
                EscrowError::TooEarly
            );
        }
        ctx.accounts.escrow.disputed_from = from;
        ctx.accounts.escrow.status = EscrowStatus::Disputed;
        Ok(())
    }

    /// Resolver returns the whole deposit to the stored buyer.
    ///
    /// Checks: status `Disputed`, disputed from `Paid` (funds still here), signer is the
    /// stored resolver, destination is the stored buyer. No time limit, so a dispute can be
    /// settled late; there is also no fallback if the resolver never acts (finding M-02).
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        transition(ctx.accounts.escrow.status, EscrowStatus::Refunded)?;
        require!(
            ctx.accounts.escrow.disputed_from == EscrowStatus::Paid,
            EscrowError::FundsAlreadyReleased
        );
        let deposit = ctx.accounts.escrow.deposit;
        move_lamports(
            &ctx.accounts.escrow.to_account_info(),
            &ctx.accounts.buyer.to_account_info(),
            deposit,
        )?;
        ctx.accounts.escrow.deposit = 0;
        ctx.accounts.escrow.status = EscrowStatus::Refunded;
        Ok(())
    }

    /// Resolver dismisses the dispute: the escrow returns to `Paid` or `Released`. Moves nothing.
    ///
    /// Returning to `Paid` does not skip the window: `release` still waits for `escrow_until`.
    /// The buyer may dispute again while the window is open (finding I-01).
    pub fn reject_dispute(ctx: Context<RejectDispute>) -> Result<()> {
        let back = ctx.accounts.escrow.disputed_from;
        require!(
            back == EscrowStatus::Paid || back == EscrowStatus::Released,
            EscrowError::IllegalTransition
        );
        transition(ctx.accounts.escrow.status, back)?;
        ctx.accounts.escrow.status = back;
        ctx.accounts.escrow.disputed_from = EscrowStatus::Pending;
        Ok(())
    }
}

/// Rejects any status change that is not an edge of the state machine in `state.rs`.
fn transition(from: EscrowStatus, to: EscrowStatus) -> Result<()> {
    require!(
        state::can_transition(from.into(), to.into()),
        EscrowError::IllegalTransition
    );
    Ok(())
}

/// Moves lamports out of a program-owned account by direct balance edits (no CPI needed, as
/// the program owns `from`). Both sides are checked; zero is a no-op so empty buckets with no
/// account are fine. The runtime still enforces that `to` ends rent-exempt or empty (L-03),
/// and borrowing the same account twice fails closed (L-04).
fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let mut from_lamports = from.try_borrow_mut_lamports()?;
    let mut to_lamports = to.try_borrow_mut_lamports()?;
    **from_lamports = from_lamports
        .checked_sub(amount)
        .ok_or(EscrowError::Overflow)?;
    **to_lamports = to_lamports
        .checked_add(amount)
        .ok_or(EscrowError::Overflow)?;
    Ok(())
}

fn map_fee(err: FeeError) -> Error {
    match err {
        FeeError::Bps => error!(EscrowError::BadBps),
        FeeError::Split => error!(EscrowError::BadSplit),
        FeeError::Overflow => error!(EscrowError::Overflow),
    }
}

/// Terms of one order, as signed by the buyer. Every field is trusted as given (see the
/// crate docs, "Trust boundary").
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeArgs {
    pub seller: Pubkey,
    pub resolver: Pubkey,
    pub buyback: Pubkey,
    pub ai_verification: Pubkey,
    pub ops: Pubkey,
    pub safety: Pubkey,
    pub price: u64,
    pub fee_bps: u16,
    pub rebate_bps: u16,
    pub split_buyback_bps: u16,
    pub split_ai_bps: u16,
    pub split_ops_bps: u16,
    pub split_safety_bps: u16,
    pub expires_at: i64,
    pub escrow_until: i64,
}

/// One order's escrow. Field order is the on-chain layout that `packages/chain` decodes;
/// do not reorder.
#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub resolver: Pubkey,
    pub buyback: Pubkey,
    pub ai_verification: Pubkey,
    pub ops: Pubkey,
    pub safety: Pubkey,
    pub status: EscrowStatus,
    /// Status before the current dispute; `Pending` when there is none.
    pub disputed_from: EscrowStatus,
    pub price: u64,
    /// Lamports `fund` moved in. Kept after `release` as a record; zeroed by `refund`.
    pub deposit: u64,
    pub fee_bps: u16,
    pub rebate_bps: u16,
    pub split_buyback_bps: u16,
    pub split_ai_bps: u16,
    pub split_ops_bps: u16,
    pub split_safety_bps: u16,
    pub expires_at: i64,
    pub escrow_until: i64,
    pub bump: u8,
    pub order_id: [u8; 16],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EscrowStatus {
    Pending,
    Paid,
    Released,
    Refunded,
    Disputed,
    Expired,
}

impl From<EscrowStatus> for Status {
    fn from(status: EscrowStatus) -> Self {
        match status {
            EscrowStatus::Pending => Status::Pending,
            EscrowStatus::Paid => Status::Paid,
            EscrowStatus::Released => Status::Released,
            EscrowStatus::Refunded => Status::Refunded,
            EscrowStatus::Disputed => Status::Disputed,
            EscrowStatus::Expired => Status::Expired,
        }
    }
}

/// `escrow` must be the canonical PDA for `order_id` and must not exist yet.
#[derive(Accounts)]
#[instruction(order_id: [u8; 16])]
pub struct Initialize<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", order_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

/// Signed by the stored buyer, who pays.
#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, has_one = buyer)]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

/// No signer. Each recipient must equal the pubkey stored in the escrow.
#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: paid the stored seller pubkey.
    #[account(mut, address = escrow.seller)]
    pub seller: UncheckedAccount<'info>,
    /// CHECK: paid the stored buyback bucket.
    #[account(mut, address = escrow.buyback)]
    pub buyback: UncheckedAccount<'info>,
    /// CHECK: paid the stored AI verification bucket.
    #[account(mut, address = escrow.ai_verification)]
    pub ai_verification: UncheckedAccount<'info>,
    /// CHECK: paid the stored ops bucket.
    #[account(mut, address = escrow.ops)]
    pub ops: UncheckedAccount<'info>,
    /// CHECK: paid the stored safety bucket.
    #[account(mut, address = escrow.safety)]
    pub safety: UncheckedAccount<'info>,
}

/// No signer, no recipients: expiring moves no lamports.
#[derive(Accounts)]
pub struct Expire<'info> {
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
}

/// Signed by the stored buyer.
#[derive(Accounts)]
pub struct OpenDispute<'info> {
    pub buyer: Signer<'info>,
    #[account(mut, has_one = buyer)]
    pub escrow: Account<'info, Escrow>,
}

/// Signed by the stored resolver; pays only the stored buyer.
#[derive(Accounts)]
pub struct Refund<'info> {
    pub resolver: Signer<'info>,
    #[account(mut, has_one = resolver)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: deposit returns to the stored buyer.
    #[account(mut, address = escrow.buyer)]
    pub buyer: UncheckedAccount<'info>,
}

/// Signed by the stored resolver.
#[derive(Accounts)]
pub struct RejectDispute<'info> {
    pub resolver: Signer<'info>,
    #[account(mut, has_one = resolver)]
    pub escrow: Account<'info, Escrow>,
}

/// Custom error codes start at 6000 in declaration order. Clients match on the numbers, so
/// only append.
#[error_code]
pub enum EscrowError {
    IllegalTransition,
    BadAmount,
    BadBps,
    BadSplit,
    Expired,
    TooEarly,
    FundsAlreadyReleased,
    Overflow,
}
