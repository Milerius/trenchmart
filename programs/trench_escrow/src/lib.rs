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

    pub fn expire(ctx: Context<Expire>) -> Result<()> {
        transition(ctx.accounts.escrow.status, EscrowStatus::Expired)?;
        let now = Clock::get()?.unix_timestamp;
        require!(now > ctx.accounts.escrow.expires_at, EscrowError::TooEarly);
        ctx.accounts.escrow.status = EscrowStatus::Expired;
        Ok(())
    }

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

fn transition(from: EscrowStatus, to: EscrowStatus) -> Result<()> {
    require!(
        state::can_transition(from.into(), to.into()),
        EscrowError::IllegalTransition
    );
    Ok(())
}

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
    pub disputed_from: EscrowStatus,
    pub price: u64,
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

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, has_one = buyer)]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

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

#[derive(Accounts)]
pub struct Expire<'info> {
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    pub buyer: Signer<'info>,
    #[account(mut, has_one = buyer)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    pub resolver: Signer<'info>,
    #[account(mut, has_one = resolver)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: deposit returns to the stored buyer.
    #[account(mut, address = escrow.buyer)]
    pub buyer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RejectDispute<'info> {
    pub resolver: Signer<'info>,
    #[account(mut, has_one = resolver)]
    pub escrow: Account<'info, Escrow>,
}

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
