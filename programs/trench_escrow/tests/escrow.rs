// Instruction-level tests for `trench_escrow`, run against the compiled SBF program in
// Mollusk (the Agave program runtime, minus the validator).
//
// The ELF comes from `anchor build` (`target/deploy/trench_escrow.so`). Without it the
// tests skip with a message, unless `TRENCH_ESCROW_REQUIRE_SBF=1`, which `anchor test`
// (Anchor.toml `[scripts] test`) sets so CI can never pass them vacuously.
//
// Every test checks the program's own error code, not just "it failed", so a check that
// starts failing for the wrong reason shows up.

use std::collections::HashMap;
use std::path::PathBuf;

use anchor_lang::error::ErrorCode as AnchorError;
use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::error::InstructionError;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use mollusk_svm::result::InstructionResult;
use mollusk_svm::Mollusk;
use proptest::prelude::*;
use solana_account::Account;
use trench_escrow::{
    Config, Escrow, EscrowError, EscrowStatus, InitializeArgs, ID as PROGRAM_ID,
    RELEASED_CLOSE_GRACE,
};

const SYSTEM_PROGRAM_ID: Pubkey = anchor_lang::system_program::ID;
const LOADER_V3: Pubkey = anchor_lang::solana_program::bpf_loader_upgradeable::ID;

const T0: i64 = 1_800_000_000;
const TTL: i64 = 15 * 60;
const WINDOW: i64 = 48 * 3_600;
const PRICE: u64 = 1_500_000_000;
const WALLET: u64 = 100_000_000_000;
const ESCROW_SPACE: usize = 8 + <Escrow as anchor_lang::Space>::INIT_SPACE;
const CONFIG_SPACE: usize = 8 + <Config as anchor_lang::Space>::INIT_SPACE;
const DISPUTE_TIMEOUT: i64 = 7 * 86_400;

fn elf() -> Option<Vec<u8>> {
    // Mollusk turns on per-instruction runtime logs; keep test output readable by default.
    static QUIET: std::sync::Once = std::sync::Once::new();
    QUIET.call_once(|| {
        if std::env::var_os("RUST_LOG").is_none() {
            std::env::set_var("RUST_LOG", "error");
        }
    });
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/trench_escrow.so");
    match std::fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(err) => {
            assert!(
                std::env::var("TRENCH_ESCROW_REQUIRE_SBF").is_err(),
                "TRENCH_ESCROW_REQUIRE_SBF is set but {} is unreadable: {err}",
                path.display()
            );
            eprintln!(
                "skipping: {} not built (run `anchor build`)",
                path.display()
            );
            None
        }
    }
}

fn custom(code: u32) -> Result<(), InstructionError> {
    Err(InstructionError::Custom(code))
}

fn program_err(err: EscrowError) -> Result<(), InstructionError> {
    custom(6_000 + err as u32)
}

fn anchor_err(err: AnchorError) -> Result<(), InstructionError> {
    custom(err as u32)
}

fn wallet(lamports: u64) -> Account {
    Account::new(lamports, 0, &SYSTEM_PROGRAM_ID)
}

fn escrow_pda(buyer: &Pubkey, order_id: &[u8; 16]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"escrow", buyer.as_ref(), order_id], &PROGRAM_ID)
}

fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"config"], &PROGRAM_ID)
}

fn program_data_pda() -> Pubkey {
    Pubkey::find_program_address(&[PROGRAM_ID.as_ref()], &LOADER_V3).0
}

/// A loader-v3 ProgramData account (bincode layout) with the given upgrade authority.
fn program_data_account(authority: Option<Pubkey>) -> Account {
    let mut data = Vec::new();
    data.extend_from_slice(&3u32.to_le_bytes());
    data.extend_from_slice(&1u64.to_le_bytes());
    match authority {
        Some(key) => {
            data.push(1);
            data.extend_from_slice(key.as_ref());
        }
        None => data.push(0),
    }
    Account {
        lamports: 1_000_000_000,
        data,
        owner: LOADER_V3,
        executable: false,
        rent_epoch: 0,
    }
}

fn config_account(admin: Pubkey, resolver: Pubkey, timeout: i64, bump: u8) -> Account {
    let config = Config {
        admin,
        resolver,
        dispute_timeout: timeout,
        bump,
    };
    let mut data = Vec::with_capacity(CONFIG_SPACE);
    config.try_serialize(&mut data).unwrap();
    data.resize(CONFIG_SPACE, 0);
    Account {
        lamports: 10_000_000,
        data,
        owner: PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }
}

#[derive(Clone, Copy)]
struct Parties {
    buyer: Pubkey,
    seller: Pubkey,
    resolver: Pubkey,
    buyback: Pubkey,
    ai: Pubkey,
    ops: Pubkey,
    safety: Pubkey,
}

impl Parties {
    fn new() -> Self {
        Self {
            buyer: Pubkey::new_unique(),
            seller: Pubkey::new_unique(),
            resolver: Pubkey::new_unique(),
            buyback: Pubkey::new_unique(),
            ai: Pubkey::new_unique(),
            ops: Pubkey::new_unique(),
            safety: Pubkey::new_unique(),
        }
    }

    fn all(&self) -> [Pubkey; 7] {
        [
            self.buyer,
            self.seller,
            self.resolver,
            self.buyback,
            self.ai,
            self.ops,
            self.safety,
        ]
    }
}

/// One escrow under test plus an account store that persists between instructions.
struct Harness {
    mollusk: Mollusk,
    accounts: HashMap<Pubkey, Account>,
    p: Parties,
    order_id: [u8; 16],
    escrow: Pubkey,
    bump: u8,
    args: InitializeArgs,
    config: Pubkey,
    admin: Pubkey,
}

fn order_id(seed: u8) -> [u8; 16] {
    let mut id = [0u8; 16];
    for (i, byte) in id.iter_mut().enumerate() {
        *byte = seed.wrapping_mul(31).wrapping_add(u8::try_from(i).unwrap());
    }
    id
}

fn default_args(p: &Parties) -> InitializeArgs {
    InitializeArgs {
        seller: p.seller,
        resolver: p.resolver,
        buyback: p.buyback,
        ai_verification: p.ai,
        ops: p.ops,
        safety: p.safety,
        price: PRICE,
        fee_bps: 500,
        rebate_bps: 6_000,
        split_buyback_bps: 4_000,
        split_ai_bps: 2_500,
        split_ops_bps: 2_000,
        split_safety_bps: 1_500,
        expires_at: T0 + TTL,
        escrow_until: T0 + TTL + WINDOW,
    }
}

impl Harness {
    fn new() -> Option<Self> {
        Self::with(|_| {})
    }

    fn with(edit: impl FnOnce(&mut InitializeArgs)) -> Option<Self> {
        let elf = elf()?;
        let mut mollusk = Mollusk::default();
        mollusk.add_program_with_loader_and_elf(&PROGRAM_ID, &LOADER_V3, &elf);
        mollusk.sysvars.clock.unix_timestamp = T0;
        // Report rent violations as a failed result (as the runtime does) instead of panicking.
        mollusk.config.panic = false;
        let p = Parties::new();
        let mut args = default_args(&p);
        edit(&mut args);
        let order_id = order_id(7);
        let (escrow, bump) = escrow_pda(&p.buyer, &order_id);
        let (config, config_bump) = config_pda();
        let admin = Pubkey::new_unique();
        let mut accounts = HashMap::new();
        accounts.insert(p.buyer, wallet(WALLET));
        // Recipients hold a balance, as real wallets do (see the rent tests for empty ones).
        for key in [p.seller, p.resolver, p.buyback, p.ai, p.ops, p.safety] {
            accounts.insert(key, wallet(1_000_000_000));
        }
        accounts.insert(escrow, Account::default());
        accounts.insert(
            config,
            config_account(admin, p.resolver, DISPUTE_TIMEOUT, config_bump),
        );
        accounts.insert(admin, wallet(1_000_000_000));
        Some(Self {
            mollusk,
            accounts,
            p,
            order_id,
            escrow,
            bump,
            args,
            config,
            admin,
        })
    }

    fn at(&mut self, unix: i64) -> &mut Self {
        self.mollusk.sysvars.clock.unix_timestamp = unix;
        self
    }

    fn lamports(&self, key: &Pubkey) -> u64 {
        self.accounts.get(key).map_or(0, |a| a.lamports)
    }

    fn total_lamports(&self) -> u128 {
        self.accounts.values().map(|a| u128::from(a.lamports)).sum()
    }

    fn state(&self) -> Escrow {
        let data = &self.accounts[&self.escrow].data;
        Escrow::try_deserialize(&mut data.as_slice()).expect("escrow decodes")
    }

    /// Overwrites the stored escrow, for states the instruction set cannot reach on its own.
    fn put_state(&mut self, escrow: &Escrow) {
        let mut data = Vec::with_capacity(ESCROW_SPACE);
        escrow.try_serialize(&mut data).unwrap();
        data.resize(ESCROW_SPACE, 0);
        let account = self.accounts.get_mut(&self.escrow).unwrap();
        account.data = data;
    }

    /// Runs one instruction. Account changes persist only when it succeeds, like a transaction.
    fn run(&mut self, ix: &Instruction) -> InstructionResult {
        let mut keys: Vec<Pubkey> = Vec::new();
        for meta in &ix.accounts {
            if !keys.contains(&meta.pubkey) {
                keys.push(meta.pubkey);
            }
        }
        let accounts: Vec<(Pubkey, Account)> = keys
            .iter()
            .map(|key| {
                if *key == SYSTEM_PROGRAM_ID {
                    mollusk_svm::program::keyed_account_for_system_program()
                } else {
                    (*key, self.accounts.get(key).cloned().unwrap_or_default())
                }
            })
            .collect();
        let before: u128 = accounts.iter().map(|(_, a)| u128::from(a.lamports)).sum();
        let result = self.mollusk.process_instruction(ix, &accounts);
        if result.program_result.is_ok() {
            let after: u128 = result
                .resulting_accounts
                .iter()
                .map(|(_, a)| u128::from(a.lamports))
                .sum();
            assert_eq!(before, after, "an instruction created or burned lamports");
            for (key, account) in &result.resulting_accounts {
                if *key != SYSTEM_PROGRAM_ID {
                    self.accounts.insert(*key, account.clone());
                }
            }
        }
        result
    }

    fn ok(&mut self, ix: &Instruction) {
        let result = self.run(ix);
        assert!(
            result.program_result.is_ok(),
            "expected success, got {:?}",
            result.raw_result
        );
    }

    fn fails(&mut self, ix: &Instruction, expected: Result<(), InstructionError>) {
        let snapshot = self.accounts.clone();
        let result = self.run(ix);
        assert_eq!(result.raw_result, expected);
        assert_eq!(
            snapshot, self.accounts,
            "a failed instruction changed state"
        );
    }

    // Instruction builders. `*_ix` take every account so tests can substitute any of them.

    fn init_ix_full(
        &self,
        buyer: Pubkey,
        escrow: Pubkey,
        id: [u8; 16],
        args: InitializeArgs,
    ) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: trench_escrow::accounts::Initialize {
                buyer,
                escrow,
                system_program: SYSTEM_PROGRAM_ID,
            }
            .to_account_metas(None),
            data: trench_escrow::instruction::Initialize { order_id: id, args }.data(),
        }
    }

    fn init_ix(&self) -> Instruction {
        self.init_ix_full(self.p.buyer, self.escrow, self.order_id, self.args.clone())
    }

    fn fund_ix_as(&self, buyer: Pubkey) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: trench_escrow::accounts::Fund {
                buyer,
                escrow: self.escrow,
                system_program: SYSTEM_PROGRAM_ID,
            }
            .to_account_metas(None),
            data: trench_escrow::instruction::Fund {}.data(),
        }
    }

    fn fund_ix(&self) -> Instruction {
        self.fund_ix_as(self.p.buyer)
    }

    fn release_ix_to(&self, to: [Pubkey; 5]) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: trench_escrow::accounts::Release {
                escrow: self.escrow,
                seller: to[0],
                buyback: to[1],
                ai_verification: to[2],
                ops: to[3],
                safety: to[4],
            }
            .to_account_metas(None),
            data: trench_escrow::instruction::Release {}.data(),
        }
    }

    fn recipients(&self) -> [Pubkey; 5] {
        [
            self.p.seller,
            self.p.buyback,
            self.p.ai,
            self.p.ops,
            self.p.safety,
        ]
    }

    fn release_ix(&self) -> Instruction {
        self.release_ix_to(self.recipients())
    }

    fn expire_ix(&self) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: trench_escrow::accounts::Expire {
                escrow: self.escrow,
            }
            .to_account_metas(None),
            data: trench_escrow::instruction::Expire {}.data(),
        }
    }

    fn dispute_ix_as(&self, buyer: Pubkey) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: trench_escrow::accounts::OpenDispute {
                signer: buyer,
                config: self.config,
                escrow: self.escrow,
            }
            .to_account_metas(None),
            data: trench_escrow::instruction::OpenDispute {}.data(),
        }
    }

    fn dispute_ix(&self) -> Instruction {
        self.dispute_ix_as(self.p.buyer)
    }

    fn refund_ix_full(&self, resolver: Pubkey, buyer: Pubkey) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: trench_escrow::accounts::Refund {
                resolver,
                config: self.config,
                escrow: self.escrow,
                buyer,
            }
            .to_account_metas(None),
            data: trench_escrow::instruction::Refund {}.data(),
        }
    }

    fn refund_ix(&self) -> Instruction {
        self.refund_ix_full(self.p.resolver, self.p.buyer)
    }

    fn reject_ix_as(&self, resolver: Pubkey) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: trench_escrow::accounts::RejectDispute {
                resolver,
                config: self.config,
                escrow: self.escrow,
            }
            .to_account_metas(None),
            data: trench_escrow::instruction::RejectDispute {}.data(),
        }
    }

    fn reject_ix(&self) -> Instruction {
        self.reject_ix_as(self.p.resolver)
    }

    fn freeze_ix_as(&self, resolver: Pubkey) -> Instruction {
        self.dispute_ix_as(resolver)
    }

    fn timeout_ix_to(&self, buyer: Pubkey) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: trench_escrow::accounts::RefundAfterTimeout {
                config: self.config,
                escrow: self.escrow,
                buyer,
            }
            .to_account_metas(None),
            data: trench_escrow::instruction::RefundAfterTimeout {}.data(),
        }
    }

    fn close_ix_to(&self, buyer: Pubkey) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: trench_escrow::accounts::Close {
                escrow: self.escrow,
                buyer,
            }
            .to_account_metas(None),
            data: trench_escrow::instruction::Close {}.data(),
        }
    }

    fn set_config_ix(
        &self,
        signer: Pubkey,
        admin: Pubkey,
        resolver: Pubkey,
        timeout: i64,
    ) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: trench_escrow::accounts::SetConfig {
                admin: signer,
                config: self.config,
            }
            .to_account_metas(None),
            data: trench_escrow::instruction::SetConfig {
                admin,
                resolver,
                dispute_timeout: timeout,
            }
            .data(),
        }
    }

    // Lifecycle shortcuts.

    fn initialized(mut self) -> Self {
        let ix = self.init_ix();
        self.ok(&ix);
        self
    }

    fn funded(self) -> Self {
        let mut h = self.initialized();
        let ix = h.fund_ix();
        h.ok(&ix);
        h
    }

    fn disputed(self) -> Self {
        let mut h = self.funded();
        let ix = h.dispute_ix();
        h.ok(&ix);
        h
    }

    fn released(self) -> Self {
        let mut h = self.funded();
        let until = h.args.escrow_until;
        h.at(until);
        let ix = h.release_ix();
        h.ok(&ix);
        h
    }

    fn rent_floor(&self) -> u64 {
        self.mollusk.sysvars.rent.minimum_balance(ESCROW_SPACE)
    }
}

/// Clears the signer flag on one account meta, as if that key never signed.
fn unsigned(mut ix: Instruction, key: Pubkey) -> Instruction {
    for meta in &mut ix.accounts {
        if meta.pubkey == key {
            meta.is_signer = false;
        }
    }
    ix
}

/// Clears the writable flag on one account meta.
fn readonly(mut ix: Instruction, key: Pubkey) -> Instruction {
    for meta in &mut ix.accounts {
        if meta.pubkey == key {
            meta.is_writable = false;
        }
    }
    ix
}

macro_rules! harness {
    () => {
        match Harness::new() {
            Some(h) => h,
            None => return,
        }
    };
    ($edit:expr) => {
        match Harness::with($edit) {
            Some(h) => h,
            None => return,
        }
    };
}

// ---------------------------------------------------------------- initialize

#[test]
fn initialize_stores_terms_and_charges_only_rent() {
    let mut h = harness!();
    let ix = h.init_ix();
    h.ok(&ix);
    let s = h.state();
    assert_eq!(s.buyer, h.p.buyer, "buyer is the signer, never an argument");
    assert_eq!(s.seller, h.p.seller);
    assert_eq!(s.resolver, h.p.resolver);
    assert_eq!(
        [s.buyback, s.ai_verification, s.ops, s.safety],
        [h.p.buyback, h.p.ai, h.p.ops, h.p.safety]
    );
    assert!(s.status == EscrowStatus::Pending);
    assert!(s.disputed_from == EscrowStatus::Pending);
    assert_eq!(s.price, PRICE);
    assert_eq!(s.deposit, 0);
    assert_eq!((s.fee_bps, s.rebate_bps), (500, 6_000));
    assert_eq!(
        [
            s.split_buyback_bps,
            s.split_ai_bps,
            s.split_ops_bps,
            s.split_safety_bps
        ],
        [4_000, 2_500, 2_000, 1_500]
    );
    assert_eq!(
        (s.expires_at, s.escrow_until),
        (h.args.expires_at, h.args.escrow_until)
    );
    assert_eq!(s.bump, h.bump, "canonical bump is stored");
    assert_eq!(s.order_id, h.order_id);
    let escrow = &h.accounts[&h.escrow];
    assert_eq!(escrow.owner, PROGRAM_ID);
    assert_eq!(escrow.data.len(), ESCROW_SPACE);
    assert_eq!(
        escrow.lamports,
        h.rent_floor(),
        "escrow holds exactly the rent floor"
    );
    assert_eq!(h.lamports(&h.p.buyer), WALLET - h.rent_floor());
}

#[test]
fn initialize_rejects_fee_bps_above_100_percent() {
    let mut h = harness!(|a| a.fee_bps = 10_001);
    let ix = h.init_ix();
    h.fails(&ix, program_err(EscrowError::BadBps));
}

#[test]
fn initialize_rejects_rebate_bps_above_100_percent() {
    let mut h = harness!(|a| a.rebate_bps = 10_001);
    let ix = h.init_ix();
    h.fails(&ix, program_err(EscrowError::BadBps));
}

#[test]
fn initialize_rejects_split_that_does_not_sum_to_10000() {
    for split in [
        [4_000, 2_500, 2_000, 1_499],
        [4_000, 2_500, 2_000, 1_501],
        [0, 0, 0, 0],
        [u16::MAX, u16::MAX, u16::MAX, u16::MAX],
        // Would wrap to 10_000 in u16 arithmetic: the program sums in u32.
        [u16::MAX, 10_001, 0, 0],
    ] {
        let mut h = harness!(|a| {
            a.split_buyback_bps = split[0];
            a.split_ai_bps = split[1];
            a.split_ops_bps = split[2];
            a.split_safety_bps = split[3];
        });
        let ix = h.init_ix();
        h.fails(&ix, program_err(EscrowError::BadSplit));
    }
}

#[test]
fn initialize_rejects_price_whose_total_overflows_u64() {
    let mut h = harness!(|a| {
        a.price = u64::MAX;
        a.fee_bps = 10_000;
        a.rebate_bps = 0;
    });
    let ix = h.init_ix();
    h.fails(&ix, program_err(EscrowError::Overflow));
}

#[test]
fn initialize_accepts_largest_non_overflowing_price() {
    // price + price * 500 / 10_000 must fit in u64.
    let max = u64::MAX / 10_500 * 10_000;
    let mut h = harness!(|a| {
        a.price = max;
        a.rebate_bps = 0;
    });
    let ix = h.init_ix();
    h.ok(&ix);
    assert_eq!(h.state().price, max);
}

#[test]
fn initialize_rejects_pda_from_other_order_id() {
    let mut h = harness!();
    let (other, _) = escrow_pda(&h.p.buyer, &order_id(8));
    h.accounts.insert(other, Account::default());
    let ix = h.init_ix_full(h.p.buyer, other, h.order_id, h.args.clone());
    h.fails(&ix, anchor_err(AnchorError::ConstraintSeeds));
}

#[test]
fn initialize_rejects_non_canonical_bump_address() {
    let mut h = harness!();
    let canonical = h.bump;
    let other = (0..canonical)
        .rev()
        .find_map(|bump| {
            Pubkey::create_program_address(
                &[b"escrow", h.p.buyer.as_ref(), &h.order_id, &[bump]],
                &PROGRAM_ID,
            )
            .ok()
        })
        .expect("a second off-curve bump exists");
    h.accounts.insert(other, Account::default());
    let ix = h.init_ix_full(h.p.buyer, other, h.order_id, h.args.clone());
    h.fails(&ix, anchor_err(AnchorError::ConstraintSeeds));
}

#[test]
fn initialize_rejects_arbitrary_keypair_address() {
    let mut h = harness!();
    let random = Pubkey::new_unique();
    h.accounts.insert(random, Account::default());
    let ix = h.init_ix_full(h.p.buyer, random, h.order_id, h.args.clone());
    h.fails(&ix, anchor_err(AnchorError::ConstraintSeeds));
}

#[test]
fn initialize_requires_buyer_signature() {
    let mut h = harness!();
    let ix = unsigned(h.init_ix(), h.p.buyer);
    h.fails(&ix, anchor_err(AnchorError::AccountNotSigner));
}

#[test]
fn initialize_rejects_fake_system_program() {
    let mut h = harness!();
    let mut ix = h.init_ix();
    let fake = Pubkey::new_unique();
    ix.accounts[2] = AccountMeta::new_readonly(fake, false);
    h.accounts.insert(fake, wallet(1));
    h.fails(&ix, anchor_err(AnchorError::InvalidProgramId));
}

#[test]
fn initialize_twice_is_rejected_reinit_attack() {
    let mut h = harness!().funded();
    let before = h.state();
    // An attacker re-runs initialize on the live PDA with themselves as resolver and seller.
    let attacker = Pubkey::new_unique();
    h.accounts.insert(attacker, wallet(WALLET));
    let mut evil = h.args.clone();
    evil.seller = attacker;
    evil.resolver = attacker;
    let ix = h.init_ix_full(attacker, h.escrow, h.order_id, evil.clone());
    let result = h.run(&ix);
    assert!(
        result.program_result.is_err(),
        "re-initialization must fail"
    );
    // The real buyer cannot reset it either.
    let ix = h.init_ix_full(h.p.buyer, h.escrow, h.order_id, evil);
    let result = h.run(&ix);
    assert!(
        result.program_result.is_err(),
        "re-initialization must fail"
    );
    let after = h.state();
    assert_eq!(after.resolver, before.resolver);
    assert_eq!(after.seller, before.seller);
    assert_eq!(after.deposit, before.deposit);
}

#[test]
fn initialize_succeeds_on_prefunded_pda() {
    // Anyone can send lamports to a PDA address before it exists. That must not brick the order.
    let mut h = harness!();
    h.accounts.insert(h.escrow, wallet(5_000));
    let ix = h.init_ix();
    h.ok(&ix);
    assert_eq!(h.accounts[&h.escrow].owner, PROGRAM_ID);
    assert_eq!(h.lamports(&h.escrow), h.rent_floor().max(5_000));
}

#[test]
fn initialize_front_run_by_other_buyer_cannot_squat_real_buyers_pda() {
    // L-02 fixed: the PDA is keyed by (buyer, order id). A squatter who learns the order id
    // cannot initialize the honest buyer's address, and their own PDA does not collide.
    let mut h = harness!();
    let squatter = Pubkey::new_unique();
    h.accounts.insert(squatter, wallet(WALLET));
    let ix = h.init_ix_full(squatter, h.escrow, h.order_id, h.args.clone());
    h.fails(&ix, anchor_err(AnchorError::ConstraintSeeds));
    let (theirs, _) = escrow_pda(&squatter, &h.order_id);
    h.accounts.insert(theirs, Account::default());
    let ix = h.init_ix_full(squatter, theirs, h.order_id, h.args.clone());
    h.ok(&ix);
    // The honest checkout still works.
    let ix = h.init_ix();
    h.ok(&ix);
    let ix = h.fund_ix();
    h.ok(&ix);
    assert_eq!(h.state().buyer, h.p.buyer);
}

// ---------------------------------------------------------------- fund

#[test]
fn fund_moves_exact_total_into_escrow() {
    let mut h = harness!().initialized();
    let buyer_before = h.lamports(&h.p.buyer);
    let ix = h.fund_ix();
    h.ok(&ix);
    let total = 1_530_000_000; // 1.5 SOL + 5% fee - 60% rebate on the fee.
    let s = h.state();
    assert!(s.status == EscrowStatus::Paid);
    assert_eq!(s.deposit, total);
    assert_eq!(h.lamports(&h.escrow), h.rent_floor() + total);
    assert_eq!(h.lamports(&h.p.buyer), buyer_before - total);
}

#[test]
fn fund_with_full_rebate_costs_exactly_price() {
    let mut h = harness!(|a| a.rebate_bps = 10_000).initialized();
    let ix = h.fund_ix();
    h.ok(&ix);
    assert_eq!(h.state().deposit, PRICE);
}

#[test]
fn fund_rejects_signer_who_is_not_the_buyer() {
    let mut h = harness!().initialized();
    let other = Pubkey::new_unique();
    h.accounts.insert(other, wallet(WALLET));
    let ix = h.fund_ix_as(other);
    h.fails(&ix, anchor_err(AnchorError::ConstraintHasOne));
}

#[test]
fn fund_requires_buyer_signature() {
    let mut h = harness!().initialized();
    let ix = unsigned(h.fund_ix(), h.p.buyer);
    h.fails(&ix, anchor_err(AnchorError::AccountNotSigner));
}

#[test]
fn fund_accepts_last_second_and_rejects_after_expiry() {
    let mut h = harness!().initialized();
    let expires = h.args.expires_at;
    h.at(expires + 1);
    let ix = h.fund_ix();
    h.fails(&ix, program_err(EscrowError::Expired));
    h.at(expires);
    h.ok(&ix);
}

#[test]
fn fund_twice_is_rejected() {
    let mut h = harness!().funded();
    let ix = h.fund_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn fund_rejects_zero_total() {
    // initialize now refuses price 0 (L-04); fund keeps its own check for a forged state.
    let mut h = harness!().initialized();
    let mut s = h.state();
    s.price = 0;
    h.put_state(&s);
    let ix = h.fund_ix();
    h.fails(&ix, program_err(EscrowError::BadAmount));
}

#[test]
fn fund_fails_when_buyer_cannot_cover_total() {
    let mut h = harness!().initialized();
    h.accounts.get_mut(&h.p.buyer).unwrap().lamports = 1_000;
    let ix = h.fund_ix();
    let snapshot = h.accounts.clone();
    let result = h.run(&ix);
    assert!(result.program_result.is_err());
    assert_eq!(snapshot, h.accounts);
}

#[test]
fn fund_after_expire_is_rejected() {
    let mut h = harness!().initialized();
    let expires = h.args.expires_at;
    h.at(expires + 1);
    let ix = h.expire_ix();
    h.ok(&ix);
    h.at(expires - 1); // even with a clock that went backwards
    let ix = h.fund_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn fund_rejects_escrow_owned_by_another_program() {
    let mut h = harness!().initialized();
    // Same bytes, foreign owner: an attacker's look-alike account.
    let mut fake = h.accounts[&h.escrow].clone();
    fake.owner = Pubkey::new_unique();
    h.accounts.insert(h.escrow, fake);
    let ix = h.fund_ix();
    h.fails(&ix, anchor_err(AnchorError::AccountOwnedByWrongProgram));
}

#[test]
fn fund_rejects_account_with_wrong_discriminator() {
    let mut h = harness!().initialized();
    h.accounts.get_mut(&h.escrow).unwrap().data[0] ^= 0xff;
    let ix = h.fund_ix();
    h.fails(&ix, anchor_err(AnchorError::AccountDiscriminatorMismatch));
}

#[test]
fn fund_rejects_uninitialized_escrow() {
    let mut h = harness!();
    let ix = h.fund_ix();
    h.fails(&ix, anchor_err(AnchorError::AccountNotInitialized));
}

// ---------------------------------------------------------------- release

#[test]
fn release_pays_seller_and_buckets_exactly() {
    let mut h = harness!().funded();
    let before: Vec<u64> = h.recipients().iter().map(|k| h.lamports(k)).collect();
    let total_before = h.total_lamports();
    let until = h.args.escrow_until;
    h.at(until);
    let ix = h.release_ix();
    // Permissionless crank: nobody signs.
    assert!(ix.accounts.iter().all(|m| !m.is_signer));
    h.ok(&ix);
    let gained: Vec<u64> = h
        .recipients()
        .iter()
        .zip(before)
        .map(|(k, b)| h.lamports(k) - b)
        .collect();
    assert_eq!(
        gained,
        vec![PRICE, 12_000_000, 7_500_000, 6_000_000, 4_500_000]
    );
    let s = h.state();
    assert!(s.status == EscrowStatus::Released);
    assert_eq!(
        s.deposit, 1_530_000_000,
        "deposit is a record of what was paid"
    );
    assert_eq!(
        h.lamports(&h.escrow),
        h.rent_floor(),
        "only rent stays behind"
    );
    assert_eq!(h.total_lamports(), total_before);
}

#[test]
fn release_one_second_early_is_rejected() {
    let mut h = harness!().funded();
    let until = h.args.escrow_until;
    h.at(until - 1);
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::TooEarly));
}

#[test]
fn release_twice_is_rejected() {
    let mut h = harness!().released();
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn release_from_pending_is_rejected() {
    let mut h = harness!().initialized();
    let until = h.args.escrow_until;
    h.at(until);
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn release_of_disputed_escrow_is_rejected_even_after_window() {
    let mut h = harness!().disputed();
    let until = h.args.escrow_until;
    h.at(until + 365 * 86_400);
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn release_after_refund_or_expire_is_rejected() {
    let mut h = harness!().disputed();
    let ix = h.refund_ix();
    h.ok(&ix);
    let until = h.args.escrow_until;
    h.at(until);
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));

    let mut h = harness!().initialized();
    let expires = h.args.expires_at;
    h.at(expires + 1);
    let ix = h.expire_ix();
    h.ok(&ix);
    let until = h.args.escrow_until;
    h.at(until);
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn release_rejects_every_substituted_recipient() {
    let mut h = harness!().funded();
    let until = h.args.escrow_until;
    h.at(until);
    let attacker = Pubkey::new_unique();
    h.accounts.insert(attacker, wallet(1_000_000_000));
    for slot in 0..5 {
        let mut to = h.recipients();
        to[slot] = attacker;
        let ix = h.release_ix_to(to);
        h.fails(&ix, anchor_err(AnchorError::ConstraintAddress));
    }
    // Swapping two legitimate buckets is also caught.
    let mut to = h.recipients();
    to.swap(1, 3);
    let ix = h.release_ix_to(to);
    h.fails(&ix, anchor_err(AnchorError::ConstraintAddress));
    // The buyer cannot pose as the seller.
    let mut to = h.recipients();
    to[0] = h.p.buyer;
    let ix = h.release_ix_to(to);
    h.fails(&ix, anchor_err(AnchorError::ConstraintAddress));
}

#[test]
fn release_rejects_recipients_from_another_escrow() {
    let mut h = harness!().funded();
    let other = Parties::new();
    for key in other.all() {
        h.accounts.insert(key, wallet(1_000_000_000));
    }
    let until = h.args.escrow_until;
    h.at(until);
    let ix = h.release_ix_to([
        other.seller,
        other.buyback,
        other.ai,
        other.ops,
        other.safety,
    ]);
    h.fails(&ix, anchor_err(AnchorError::ConstraintAddress));
}

#[test]
fn release_requires_writable_recipients() {
    let mut h = harness!().funded();
    let until = h.args.escrow_until;
    h.at(until);
    let ix = readonly(h.release_ix(), h.p.seller);
    h.fails(&ix, anchor_err(AnchorError::ConstraintMut));
    let ix = readonly(h.release_ix(), h.escrow);
    h.fails(&ix, anchor_err(AnchorError::ConstraintMut));
}

#[test]
fn release_rejects_escrow_owned_by_another_program() {
    let mut h = harness!().funded();
    let until = h.args.escrow_until;
    h.at(until);
    h.accounts.get_mut(&h.escrow).unwrap().owner = SYSTEM_PROGRAM_ID;
    let ix = h.release_ix();
    h.fails(&ix, anchor_err(AnchorError::AccountOwnedByWrongProgram));
}

#[test]
fn release_refuses_deposit_that_does_not_match_terms() {
    // Not reachable through the instruction set; proves the defensive check holds.
    let mut h = harness!().funded();
    let mut s = h.state();
    s.deposit -= 1;
    h.put_state(&s);
    let until = h.args.escrow_until;
    h.at(until);
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::BadAmount));
}

#[test]
fn release_with_full_rebate_skips_empty_buckets() {
    // net fee is 0, so the buckets receive nothing and may even be unfunded accounts.
    let mut h = harness!(|a| a.rebate_bps = 10_000);
    for key in [h.p.buyback, h.p.ai, h.p.ops, h.p.safety] {
        h.accounts.remove(&key);
    }
    let mut h = h.released();
    assert_eq!(h.lamports(&h.p.buyback), 0);
    assert_eq!(h.lamports(&h.p.ops), 0);
    assert_eq!(h.lamports(&h.escrow), h.rent_floor());
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn release_assigns_rounding_dust_to_ops() {
    // fee = floor(1_000_003 * 500 / 10_000) = 50_000; rebate = floor(50_000 * 2_500 / 10_000)
    // = 12_500; net = 37_500. 3_333 bps of 37_500 floors, the dust lands in ops.
    let mut h = harness!(|a| {
        a.price = 1_000_003;
        a.rebate_bps = 2_500;
        a.split_buyback_bps = 3_333;
        a.split_ai_bps = 3_333;
        a.split_ops_bps = 3_333;
        a.split_safety_bps = 1;
    });
    let before: Vec<u64> = h.recipients().iter().map(|k| h.lamports(k)).collect();
    h = h.released();
    let gained: Vec<u64> = h
        .recipients()
        .iter()
        .zip(before)
        .map(|(k, b)| h.lamports(k) - b)
        .collect();
    // 37_500 * 3_333 / 10_000 = 12_498.75 -> 12_498; safety 3.75 -> 3; dust = 3.
    assert_eq!(gained, vec![1_000_003, 12_498, 12_498, 12_501, 3]);
    assert_eq!(gained.iter().sum::<u64>(), h.state().deposit);
}

#[test]
fn release_to_empty_wallet_below_rent_floor_fails_and_keeps_funds() {
    // Documents finding L-03: a recipient with 0 lamports cannot receive less than the rent
    // floor. Release fails atomically; nothing is lost, and anyone can unblock it by topping
    // the wallet up.
    let mut h = harness!(|a| {
        a.price = 10_000;
        a.rebate_bps = 10_000;
    });
    h.accounts.remove(&h.p.seller);
    let mut h = h.funded();
    let until = h.args.escrow_until;
    h.at(until);
    let ix = h.release_ix();
    let snapshot = h.accounts.clone();
    let result = h.run(&ix);
    assert!(
        result.program_result.is_err(),
        "sub-rent credit to an empty account"
    );
    assert_eq!(snapshot, h.accounts);
    h.accounts.insert(h.p.seller, wallet(1_000_000));
    h.ok(&ix);
    assert_eq!(h.lamports(&h.p.seller), 1_010_000);
}

#[test]
fn release_with_same_wallet_for_two_buckets_pays_the_sum() {
    let mut h = harness!(|a| a.ops = a.buyback);
    let buyback = h.p.buyback;
    h.p.ops = buyback;
    let before = h.lamports(&buyback);
    let h = h.released();
    assert_eq!(h.lamports(&buyback) - before, 12_000_000 + 6_000_000);
}

#[test]
fn initialize_rejects_escrow_or_default_key_as_recipient() {
    // L-04 fixed: a recipient equal to the escrow PDA used to brick `release` forever.
    for field in 0..5 {
        for bad in [None, Some(Pubkey::default())] {
            let mut h = harness!();
            let key = bad.unwrap_or(h.escrow);
            match field {
                0 => h.args.seller = key,
                1 => h.args.buyback = key,
                2 => h.args.ai_verification = key,
                3 => h.args.ops = key,
                _ => h.args.safety = key,
            }
            let ix = h.init_ix();
            h.fails(&ix, program_err(EscrowError::BadTerms));
        }
    }
}

#[test]
fn initialize_rejects_zero_price() {
    let mut h = harness!(|a| a.price = 0);
    let ix = h.init_ix();
    h.fails(&ix, program_err(EscrowError::BadAmount));
}

#[test]
fn initialize_rejects_incoherent_times() {
    // escrow_until before expires_at.
    let mut h = harness!(|a| a.escrow_until = a.expires_at - 1);
    let ix = h.init_ix();
    h.fails(&ix, program_err(EscrowError::BadTerms));
    // expires_at already in the past.
    let mut h = harness!(|a| a.expires_at = T0 - 1);
    let ix = h.init_ix();
    h.fails(&ix, program_err(EscrowError::BadTerms));
    // Boundaries are accepted: expires_at == now, escrow_until == expires_at.
    let mut h = harness!(|a| {
        a.expires_at = T0;
        a.escrow_until = T0;
    });
    let ix = h.init_ix();
    h.ok(&ix);
}

// ---------------------------------------------------------------- expire

#[test]
fn expire_marks_unfunded_escrow_after_deadline() {
    let mut h = harness!().initialized();
    let expires = h.args.expires_at;
    h.at(expires + 1);
    let ix = h.expire_ix();
    assert!(ix.accounts.iter().all(|m| !m.is_signer), "permissionless");
    let lamports = h.lamports(&h.escrow);
    h.ok(&ix);
    assert!(h.state().status == EscrowStatus::Expired);
    // Finding L-01: the rent stays locked; there is no close instruction.
    assert_eq!(h.lamports(&h.escrow), lamports);
}

#[test]
fn expire_at_or_before_deadline_is_rejected() {
    let mut h = harness!().initialized();
    let expires = h.args.expires_at;
    for now in [T0, expires - 1, expires] {
        h.at(now);
        let ix = h.expire_ix();
        h.fails(&ix, program_err(EscrowError::TooEarly));
    }
}

#[test]
fn expire_cannot_touch_a_funded_escrow() {
    let mut h = harness!().funded();
    let expires = h.args.escrow_until + 1;
    h.at(expires);
    let ix = h.expire_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn expire_twice_is_rejected() {
    let mut h = harness!().initialized();
    let expires = h.args.expires_at;
    h.at(expires + 1);
    let ix = h.expire_ix();
    h.ok(&ix);
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

// ---------------------------------------------------------------- open_dispute

#[test]
fn open_dispute_freezes_paid_escrow() {
    let mut h = harness!().funded();
    let lamports = h.lamports(&h.escrow);
    let ix = h.dispute_ix();
    h.ok(&ix);
    let s = h.state();
    assert!(s.status == EscrowStatus::Disputed);
    assert!(s.disputed_from == EscrowStatus::Paid);
    assert_eq!(h.lamports(&h.escrow), lamports, "a dispute moves no funds");
}

#[test]
fn open_dispute_last_second_ok_at_window_end_rejected() {
    let mut h = harness!().funded();
    let until = h.args.escrow_until;
    h.at(until);
    let ix = h.dispute_ix();
    h.fails(&ix, program_err(EscrowError::WindowClosed));
    h.at(until - 1);
    h.ok(&ix);
}

#[test]
fn open_dispute_only_by_buyer_or_config_resolver() {
    let mut h = harness!().funded();
    for who in [h.p.seller, h.admin, Pubkey::new_unique()] {
        h.accounts.entry(who).or_insert_with(|| wallet(1));
        let ix = h.dispute_ix_as(who);
        h.fails(&ix, program_err(EscrowError::Unauthorized));
    }
    let ix = unsigned(h.dispute_ix(), h.p.buyer);
    h.fails(&ix, anchor_err(AnchorError::AccountNotSigner));
}

#[test]
fn open_dispute_rejected_from_pending_disputed_refunded_expired() {
    let mut h = harness!().initialized();
    let ix = h.dispute_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));

    let mut h = harness!().disputed();
    let ix = h.dispute_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    let ix = h.refund_ix();
    h.ok(&ix);
    let ix = h.dispute_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));

    let mut h = harness!().initialized();
    let expires = h.args.expires_at;
    h.at(expires + 1);
    let ix = h.expire_ix();
    h.ok(&ix);
    let ix = h.dispute_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn dispute_after_release_cannot_claw_back_funds() {
    let mut h = harness!().released();
    let much_later = h.args.escrow_until + 30 * 86_400;
    h.at(much_later);
    let ix = h.dispute_ix();
    h.ok(&ix);
    let s = h.state();
    assert!(s.status == EscrowStatus::Disputed);
    assert!(s.disputed_from == EscrowStatus::Released);
    // The resolver cannot refund money that already left.
    let ix = h.refund_ix();
    h.fails(&ix, program_err(EscrowError::FundsAlreadyReleased));
    // A permissionless release cannot run again either.
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    let ix = h.reject_ix();
    h.ok(&ix);
    assert!(h.state().status == EscrowStatus::Released);
    assert_eq!(h.lamports(&h.escrow), h.rent_floor());
}

// ---------------------------------------------------------------- refund

#[test]
fn refund_returns_full_deposit_to_buyer() {
    let mut h = harness!().disputed();
    let buyer_before = h.lamports(&h.p.buyer);
    let ix = h.refund_ix();
    h.ok(&ix);
    let s = h.state();
    assert!(s.status == EscrowStatus::Refunded);
    assert_eq!(s.deposit, 0);
    assert_eq!(h.lamports(&h.p.buyer), buyer_before + 1_530_000_000);
    assert_eq!(h.lamports(&h.escrow), h.rent_floor());
}

#[test]
fn refund_long_after_window_still_works() {
    let mut h = harness!().disputed();
    let later = h.args.escrow_until + 90 * 86_400;
    h.at(later);
    let ix = h.refund_ix();
    h.ok(&ix);
}

#[test]
fn refund_rejects_wrong_resolver() {
    let mut h = harness!().disputed();
    for who in [h.p.buyer, h.p.seller, Pubkey::new_unique()] {
        h.accounts.entry(who).or_insert_with(|| wallet(1));
        let ix = h.refund_ix_full(who, h.p.buyer);
        h.fails(&ix, anchor_err(AnchorError::ConstraintHasOne));
    }
}

#[test]
fn refund_requires_resolver_signature() {
    let mut h = harness!().disputed();
    let ix = unsigned(h.refund_ix(), h.p.resolver);
    h.fails(&ix, anchor_err(AnchorError::AccountNotSigner));
}

#[test]
fn refund_only_pays_the_stored_buyer() {
    let mut h = harness!().disputed();
    for to in [h.p.resolver, h.p.seller, Pubkey::new_unique()] {
        h.accounts.entry(to).or_insert_with(|| wallet(1));
        let ix = h.refund_ix_full(h.p.resolver, to);
        h.fails(&ix, anchor_err(AnchorError::ConstraintAddress));
    }
}

#[test]
fn refund_without_dispute_is_rejected() {
    let mut h = harness!().funded();
    let ix = h.refund_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    let mut h = harness!().released();
    let ix = h.refund_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    let mut h = harness!().initialized();
    let ix = h.refund_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn refund_twice_is_rejected() {
    let mut h = harness!().disputed();
    let ix = h.refund_ix();
    h.ok(&ix);
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn refund_with_forged_released_origin_is_rejected() {
    // Defensive check: even a Disputed escrow refunds only if it was disputed from Paid.
    let mut h = harness!().disputed();
    let mut s = h.state();
    s.disputed_from = EscrowStatus::Pending;
    h.put_state(&s);
    let ix = h.refund_ix();
    h.fails(&ix, program_err(EscrowError::FundsAlreadyReleased));
}

// ---------------------------------------------------------------- reject_dispute

#[test]
fn reject_dispute_returns_to_paid_and_window_still_applies() {
    let mut h = harness!().disputed();
    let lamports = h.lamports(&h.escrow);
    let ix = h.reject_ix();
    h.ok(&ix);
    let s = h.state();
    assert!(s.status == EscrowStatus::Paid);
    assert!(
        s.disputed_from == EscrowStatus::Pending,
        "dispute origin is cleared"
    );
    assert_eq!(h.lamports(&h.escrow), lamports);
    // The resolver cannot shortcut the window: release still waits for escrow_until.
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::TooEarly));
    let until = h.args.escrow_until;
    h.at(until);
    h.ok(&ix);
}

#[test]
fn reject_dispute_after_window_lets_release_run() {
    let mut h = harness!().disputed();
    let later = h.args.escrow_until + 10;
    h.at(later);
    let ix = h.reject_ix();
    h.ok(&ix);
    let ix = h.release_ix();
    h.ok(&ix);
    assert!(h.state().status == EscrowStatus::Released);
}

#[test]
fn rejected_dispute_cannot_be_refunded() {
    let mut h = harness!().disputed();
    let ix = h.reject_ix();
    h.ok(&ix);
    let ix = h.refund_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn reject_dispute_rejects_wrong_resolver_and_missing_signature() {
    let mut h = harness!().disputed();
    for who in [h.p.buyer, h.p.seller, Pubkey::new_unique()] {
        h.accounts.entry(who).or_insert_with(|| wallet(1));
        let ix = h.reject_ix_as(who);
        h.fails(&ix, anchor_err(AnchorError::ConstraintHasOne));
    }
    let ix = unsigned(h.reject_ix(), h.p.resolver);
    h.fails(&ix, anchor_err(AnchorError::AccountNotSigner));
}

#[test]
fn reject_dispute_without_dispute_is_rejected() {
    let mut h = harness!().funded();
    let ix = h.reject_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    let mut h = harness!().released();
    let ix = h.reject_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    let mut h = harness!().initialized();
    let ix = h.reject_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn reject_dispute_with_forged_origin_is_rejected() {
    let mut h = harness!().disputed();
    let mut s = h.state();
    s.disputed_from = EscrowStatus::Refunded;
    h.put_state(&s);
    let ix = h.reject_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn buyer_can_redispute_after_rejection_inside_window() {
    // Documents finding I-03: rejection does not stop the buyer from disputing again before
    // escrow_until. This only delays payout; funds still move only to the stored parties.
    let mut h = harness!().disputed();
    let ix = h.reject_ix();
    h.ok(&ix);
    let ix = h.dispute_ix();
    h.ok(&ix);
    assert!(h.state().status == EscrowStatus::Disputed);
}

#[test]
fn nobody_but_resolver_moves_disputed_funds() {
    let mut h = harness!().disputed();
    let later = h.args.escrow_until + 1;
    h.at(later);
    let snapshot = h.accounts.clone();
    // Permissionless paths are closed.
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    let ix = h.expire_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    // Buyer and seller cannot sign as resolver.
    for who in [h.p.buyer, h.p.seller] {
        let ix = h.refund_ix_full(who, h.p.buyer);
        h.fails(&ix, anchor_err(AnchorError::ConstraintHasOne));
        let ix = h.reject_ix_as(who);
        h.fails(&ix, anchor_err(AnchorError::ConstraintHasOne));
    }
    assert_eq!(snapshot, h.accounts);
}

#[test]
fn escrows_are_isolated_from_each_other() {
    // Account substitution across harnesses: B's resolver is not the configured resolver.
    let mut a = harness!().disputed();
    let b = harness!().disputed();
    a.accounts.insert(b.p.resolver, wallet(1));
    a.accounts.insert(b.p.buyer, wallet(1));
    let ix = a.refund_ix_full(b.p.resolver, a.p.buyer);
    a.fails(&ix, anchor_err(AnchorError::ConstraintHasOne));
    let ix = a.refund_ix_full(a.p.resolver, b.p.buyer);
    a.fails(&ix, anchor_err(AnchorError::ConstraintAddress));
}

#[test]
fn instruction_with_unknown_discriminator_is_rejected() {
    let mut h = harness!().funded();
    let mut ix = h.release_ix();
    ix.data = vec![0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 0];
    h.fails(&ix, anchor_err(AnchorError::InstructionFallbackNotFound));
}

#[test]
fn instruction_with_missing_accounts_is_rejected() {
    let mut h = harness!().funded();
    let until = h.args.escrow_until;
    h.at(until);
    let mut ix = h.release_ix();
    ix.accounts.truncate(3);
    h.fails(&ix, anchor_err(AnchorError::AccountNotEnoughKeys));
}

// ---------------------------------------------------------------- full lifecycles, property

#[test]
fn every_lamport_is_accounted_for_across_a_lifecycle() {
    let mut h = harness!();
    let start = h.total_lamports();
    h = h.disputed();
    let ix = h.reject_ix();
    h.ok(&ix);
    let until = h.args.escrow_until;
    h.at(until);
    let ix = h.release_ix();
    h.ok(&ix);
    assert_eq!(h.total_lamports(), start);
    assert_eq!(
        h.lamports(&h.p.buyer),
        WALLET - h.rent_floor() - 1_530_000_000
    );
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]

    #[test]
    fn release_conserves_lamports_for_any_terms(
        price in 1u64..=1_000_000_000_000,
        fee_bps in 0u16..=10_000,
        rebate_bps in 0u16..=10_000,
        buyback in 0u16..=10_000,
        ai_frac in 0u16..=10_000,
        ops_frac in 0u16..=10_000,
    ) {
        let ai = u16::try_from(u32::from(10_000 - buyback) * u32::from(ai_frac) / 10_000).unwrap();
        let ops = u16::try_from(u32::from(10_000 - buyback - ai) * u32::from(ops_frac) / 10_000).unwrap();
        let safety = 10_000 - buyback - ai - ops;
        let Some(mut h) = Harness::with(|a| {
            a.price = price;
            a.fee_bps = fee_bps;
            a.rebate_bps = rebate_bps;
            a.split_buyback_bps = buyback;
            a.split_ai_bps = ai;
            a.split_ops_bps = ops;
            a.split_safety_bps = safety;
        }) else {
            return Ok(());
        };
        h.accounts.insert(h.p.buyer, wallet(u64::MAX / 4));
        let before: Vec<u64> = h.recipients().iter().map(|k| h.lamports(k)).collect();
        let h = h.released();
        let gained: Vec<u64> = h.recipients().iter().zip(before).map(|(k, b)| h.lamports(k) - b).collect();
        let fee = u128::from(price) * u128::from(fee_bps) / 10_000;
        let rebate = fee * u128::from(rebate_bps) / 10_000;
        let total = u128::from(price) + fee - rebate;
        prop_assert_eq!(u128::from(h.state().deposit), total);
        prop_assert_eq!(gained[0], price);
        prop_assert_eq!(gained.iter().map(|g| u128::from(*g)).sum::<u128>(), total);
        prop_assert_eq!(h.lamports(&h.escrow), h.rent_floor());
    }
}

// ---------------------------------------------------------------- v2: config

fn init_config_ix(
    authority: Pubkey,
    program_data: Pubkey,
    resolver: Pubkey,
    timeout: i64,
) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: trench_escrow::accounts::InitConfig {
            authority,
            program_data,
            config: config_pda().0,
            system_program: SYSTEM_PROGRAM_ID,
        }
        .to_account_metas(None),
        data: trench_escrow::instruction::InitConfig {
            resolver,
            dispute_timeout: timeout,
        }
        .data(),
    }
}

#[test]
fn init_config_only_by_upgrade_authority() {
    let mut h = harness!();
    h.accounts.insert(h.config, Account::default());
    let upgrader = Pubkey::new_unique();
    let stranger = Pubkey::new_unique();
    h.accounts.insert(upgrader, wallet(WALLET));
    h.accounts.insert(stranger, wallet(WALLET));
    let pd = program_data_pda();
    h.accounts.insert(pd, program_data_account(Some(upgrader)));
    let resolver = h.p.resolver;
    let ix = init_config_ix(stranger, pd, resolver, DISPUTE_TIMEOUT);
    h.fails(&ix, program_err(EscrowError::ConfigAuthority));
    // A fake ProgramData at another address fails the seeds check.
    let fake = Pubkey::new_unique();
    h.accounts
        .insert(fake, program_data_account(Some(stranger)));
    let ix = init_config_ix(stranger, fake, resolver, DISPUTE_TIMEOUT);
    h.fails(&ix, anchor_err(AnchorError::ConstraintSeeds));
    // Immutable program (no authority): nobody.
    h.accounts.insert(pd, program_data_account(None));
    let ix = init_config_ix(upgrader, pd, resolver, DISPUTE_TIMEOUT);
    h.fails(&ix, program_err(EscrowError::ConfigAuthority));
    h.accounts.insert(pd, program_data_account(Some(upgrader)));
    for bad in [0, 3_599, 90 * 86_400 + 1, -1] {
        let ix = init_config_ix(upgrader, pd, resolver, bad);
        h.fails(&ix, program_err(EscrowError::BadTimeout));
    }
    let ix = init_config_ix(upgrader, pd, Pubkey::default(), DISPUTE_TIMEOUT);
    h.fails(&ix, program_err(EscrowError::BadTerms));
    let ix = init_config_ix(upgrader, pd, resolver, DISPUTE_TIMEOUT);
    h.ok(&ix);
    let config = Config::try_deserialize(&mut h.accounts[&h.config].data.as_slice()).unwrap();
    assert_eq!(config.admin, upgrader);
    assert_eq!(config.resolver, resolver);
    assert_eq!(config.dispute_timeout, DISPUTE_TIMEOUT);
    // Once only.
    let result = h.run(&ix);
    assert!(
        result.program_result.is_err(),
        "config cannot be re-initialized"
    );
}

/// `program_data` is read by hand (no bincode): every malformed or foreign account fails closed.
#[test]
fn init_config_rejects_malformed_program_data() {
    let mut h = harness!();
    h.accounts.insert(h.config, Account::default());
    let upgrader = Pubkey::new_unique();
    h.accounts.insert(upgrader, wallet(WALLET));
    let pd = program_data_pda();
    let resolver = h.p.resolver;
    let ix = init_config_ix(upgrader, pd, resolver, DISPUTE_TIMEOUT);
    // Right bytes, wrong owner.
    let mut acc = program_data_account(Some(upgrader));
    acc.owner = Pubkey::new_unique();
    h.accounts.insert(pd, acc);
    h.fails(&ix, anchor_err(AnchorError::ConstraintOwner));
    // Another loader-v3 state tag (2 = Program) with the authority bytes in place.
    let mut acc = program_data_account(Some(upgrader));
    acc.data[..4].copy_from_slice(&2u32.to_le_bytes());
    h.accounts.insert(pd, acc);
    h.fails(&ix, program_err(EscrowError::ConfigAuthority));
    // Option tag other than 1 (Some).
    let mut acc = program_data_account(Some(upgrader));
    acc.data[12] = 2;
    h.accounts.insert(pd, acc);
    h.fails(&ix, program_err(EscrowError::ConfigAuthority));
    // Truncated authority.
    let mut acc = program_data_account(Some(upgrader));
    acc.data.truncate(44);
    h.accounts.insert(pd, acc);
    h.fails(&ix, program_err(EscrowError::ConfigAuthority));
    // Well-formed: accepted.
    h.accounts.insert(pd, program_data_account(Some(upgrader)));
    h.ok(&ix);
}

#[test]
fn set_config_rotates_resolver_for_in_flight_escrows() {
    let mut h = harness!().disputed();
    let old = h.p.resolver;
    let new = Pubkey::new_unique();
    h.accounts.insert(new, wallet(1_000_000_000));
    // Only the admin can rotate.
    for who in [old, h.p.buyer, Pubkey::new_unique()] {
        h.accounts.entry(who).or_insert_with(|| wallet(1));
        let ix = h.set_config_ix(who, who, who, DISPUTE_TIMEOUT);
        h.fails(&ix, anchor_err(AnchorError::ConstraintHasOne));
    }
    let admin = h.admin;
    let ix = unsigned(h.set_config_ix(admin, admin, new, DISPUTE_TIMEOUT), admin);
    h.fails(&ix, anchor_err(AnchorError::AccountNotSigner));
    let ix = h.set_config_ix(admin, admin, new, 1);
    h.fails(&ix, program_err(EscrowError::BadTimeout));
    let ix = h.set_config_ix(admin, Pubkey::default(), new, DISPUTE_TIMEOUT);
    h.fails(&ix, program_err(EscrowError::BadTerms));
    let ix = h.set_config_ix(admin, admin, new, DISPUTE_TIMEOUT);
    h.ok(&ix);
    // The old (lost or leaked) resolver no longer settles anything, even though the escrow
    // still stores it as a record.
    assert_eq!(h.state().resolver, old);
    let ix = h.refund_ix_full(old, h.p.buyer);
    h.fails(&ix, anchor_err(AnchorError::ConstraintHasOne));
    let ix = h.reject_ix_as(old);
    h.fails(&ix, anchor_err(AnchorError::ConstraintHasOne));
    let ix = h.refund_ix_full(new, h.p.buyer);
    h.ok(&ix);
    assert!(h.state().status == EscrowStatus::Refunded);
}

#[test]
fn resolver_instructions_reject_a_forged_config() {
    let mut h = harness!().disputed();
    // A look-alike config owned by this program but at another address.
    let fake = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();
    h.accounts.insert(attacker, wallet(1));
    h.accounts.insert(
        fake,
        config_account(attacker, attacker, DISPUTE_TIMEOUT, 255),
    );
    let mut ix = h.refund_ix_full(attacker, h.p.buyer);
    ix.accounts[1].pubkey = fake;
    h.fails(&ix, anchor_err(AnchorError::ConstraintSeeds));
}

// ---------------------------------------------------------------- v2: freeze (M-01)

#[test]
fn resolver_freezes_paid_escrow_inside_window() {
    let mut h = harness!().funded();
    let lamports = h.lamports(&h.escrow);
    let ix = h.freeze_ix_as(h.p.resolver);
    h.ok(&ix);
    let s = h.state();
    assert!(s.status == EscrowStatus::Disputed);
    assert!(s.disputed_from == EscrowStatus::Paid);
    assert_eq!(h.lamports(&h.escrow), lamports, "freeze moves no funds");
    // The permissionless release can no longer race the dispute.
    let until = h.args.escrow_until;
    h.at(until + 1);
    let ix = h.release_ix();
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    let ix = h.refund_ix();
    h.ok(&ix);
}

#[test]
fn freeze_only_by_config_resolver_with_signature() {
    let mut h = harness!().funded();
    for who in [h.p.seller, h.admin, Pubkey::new_unique()] {
        h.accounts.entry(who).or_insert_with(|| wallet(1));
        let ix = h.freeze_ix_as(who);
        h.fails(&ix, program_err(EscrowError::Unauthorized));
    }
    let ix = unsigned(h.freeze_ix_as(h.p.resolver), h.p.resolver);
    h.fails(&ix, anchor_err(AnchorError::AccountNotSigner));
}

#[test]
fn freeze_window_boundary_and_states() {
    let mut h = harness!().funded();
    let until = h.args.escrow_until;
    h.at(until);
    let ix = h.freeze_ix_as(h.p.resolver);
    h.fails(&ix, program_err(EscrowError::WindowClosed));
    h.at(until - 1);
    h.ok(&ix);
    // Already disputed.
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    let mut h = harness!().initialized();
    let ix = h.freeze_ix_as(h.p.resolver);
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    // Post-release disputes are the buyer's record only.
    let mut h = harness!().released();
    let ix = h.freeze_ix_as(h.p.resolver);
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

// ---------------------------------------------------------------- v2: dispute timeout (M-02)

#[test]
fn refund_after_timeout_returns_deposit_to_buyer_only_after_deadline() {
    let mut h = harness!().disputed();
    let deadline = h.args.escrow_until + DISPUTE_TIMEOUT;
    let buyer_before = h.lamports(&h.p.buyer);
    h.at(deadline - 1);
    let ix = h.timeout_ix_to(h.p.buyer);
    h.fails(&ix, program_err(EscrowError::TimeoutNotReached));
    h.at(deadline);
    // Destination is pinned to the stored buyer.
    for to in [h.p.seller, h.p.resolver, Pubkey::new_unique()] {
        h.accounts.entry(to).or_insert_with(|| wallet(1));
        let bad = h.timeout_ix_to(to);
        h.fails(&bad, anchor_err(AnchorError::ConstraintAddress));
    }
    h.ok(&ix);
    let s = h.state();
    assert!(s.status == EscrowStatus::Refunded);
    assert_eq!(s.deposit, 0);
    assert_eq!(h.lamports(&h.p.buyer), buyer_before + 1_530_000_000);
    assert_eq!(h.lamports(&h.escrow), h.rent_floor());
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
}

#[test]
fn refund_after_timeout_refuses_undisputed_released_or_post_release_dispute() {
    let far = 1_000 * 86_400;
    let mut h = harness!().funded();
    let t = h.args.escrow_until + far;
    h.at(t);
    let ix = h.timeout_ix_to(h.p.buyer);
    h.fails(&ix, program_err(EscrowError::IllegalTransition));
    let mut h = harness!().released();
    let ix = h.dispute_ix();
    h.ok(&ix);
    let t = h.args.escrow_until + far;
    h.at(t);
    let ix = h.timeout_ix_to(h.p.buyer);
    h.fails(&ix, program_err(EscrowError::FundsAlreadyReleased));
}

#[test]
fn refund_after_timeout_rejects_forged_config() {
    let mut h = harness!().disputed();
    let fake = Pubkey::new_unique();
    h.accounts
        .insert(fake, config_account(h.admin, h.p.resolver, 3_600, 255));
    let t = h.args.escrow_until + 3_600;
    h.at(t);
    let mut ix = h.timeout_ix_to(h.p.buyer);
    ix.accounts[0].pubkey = fake;
    h.fails(&ix, anchor_err(AnchorError::ConstraintSeeds));
}

// ---------------------------------------------------------------- v2: close (L-01)

#[test]
fn close_returns_rent_to_buyer_for_refunded_and_expired() {
    let mut h = harness!().disputed();
    let ix = h.refund_ix();
    h.ok(&ix);
    let before = h.lamports(&h.p.buyer);
    let rent = h.rent_floor();
    let ix = h.close_ix_to(h.p.buyer);
    h.ok(&ix);
    assert_eq!(h.lamports(&h.p.buyer), before + rent);
    assert_eq!(h.lamports(&h.escrow), 0);

    let mut h = harness!().initialized();
    let t = h.args.expires_at + 1;
    h.at(t);
    let ix = h.expire_ix();
    h.ok(&ix);
    let before = h.lamports(&h.p.buyer);
    let ix = h.close_ix_to(h.p.buyer);
    h.ok(&ix);
    assert_eq!(h.lamports(&h.p.buyer), before + h.rent_floor());
}

#[test]
fn close_pays_only_the_stored_buyer() {
    let mut h = harness!().disputed();
    let ix = h.refund_ix();
    h.ok(&ix);
    for to in [h.p.seller, h.p.resolver, Pubkey::new_unique()] {
        h.accounts.entry(to).or_insert_with(|| wallet(1));
        let ix = h.close_ix_to(to);
        h.fails(&ix, anchor_err(AnchorError::ConstraintAddress));
    }
}

#[test]
fn close_refuses_live_escrows_and_released_inside_grace() {
    let mut h = harness!().initialized();
    let ix = h.close_ix_to(h.p.buyer);
    h.fails(&ix, program_err(EscrowError::NotClosable));
    let mut h = harness!().funded();
    let ix = h.close_ix_to(h.p.buyer);
    h.fails(&ix, program_err(EscrowError::NotClosable));
    let mut h = harness!().disputed();
    let ix = h.close_ix_to(h.p.buyer);
    h.fails(&ix, program_err(EscrowError::NotClosable));
    let mut h = harness!().released();
    let grace = h.args.escrow_until + RELEASED_CLOSE_GRACE;
    h.at(grace - 1);
    let ix = h.close_ix_to(h.p.buyer);
    h.fails(&ix, program_err(EscrowError::NotClosable));
    h.at(grace);
    let before = h.lamports(&h.p.buyer);
    h.ok(&ix);
    assert_eq!(h.lamports(&h.p.buyer), before + h.rent_floor());
}

#[test]
fn v1_escrow_at_legacy_address_still_releases_and_refunds() {
    // Escrows created by v1 live at ["escrow", order_id]. Only `initialize` checks seeds, so
    // in-flight v1 escrows keep working after the upgrade.
    let mut h = harness!().funded();
    let state = h.accounts.remove(&h.escrow).unwrap();
    let (legacy, _) = Pubkey::find_program_address(&[b"escrow", &h.order_id], &PROGRAM_ID);
    h.accounts.insert(legacy, state);
    h.escrow = legacy;
    let ix = h.freeze_ix_as(h.p.resolver);
    h.ok(&ix);
    let ix = h.refund_ix();
    h.ok(&ix);
    let ix = h.close_ix_to(h.p.buyer);
    h.ok(&ix);
}
