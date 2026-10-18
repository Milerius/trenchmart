//! Integer fee math. Matches `packages/shared/src/fee.ts`: floor division, dust to ops.
//!
//! Invariants (unit- and property-tested below):
//! - `fee = floor(price * fee_bps / 10_000)` and `rebate = floor(fee * rebate_bps / 10_000)`,
//!   computed in `u128`, so the multiply cannot overflow.
//! - `rebate <= fee`, so `net_fee = fee - rebate` and `total = price + net_fee` never underflow;
//!   the only reachable overflow is `price + fee > u64::MAX`, reported as `Overflow`.
//! - The four split parts always add up to exactly `net_fee`; rounding dust goes to ops.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeeQuote {
    pub price: u64,
    pub fee: u64,
    pub rebate: u64,
    pub total: u64,
    pub net_fee: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeeSplit {
    pub buyback: u64,
    pub ai_verification: u64,
    pub ops: u64,
    pub safety: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeeError {
    Bps,
    Overflow,
    Split,
}

/// Buyer-facing price breakdown. Rejects bps above 100% and totals that overflow `u64`.
pub fn quote(price: u64, fee_bps: u16, rebate_bps: u16) -> Result<FeeQuote, FeeError> {
    if fee_bps > 10_000 || rebate_bps > 10_000 {
        return Err(FeeError::Bps);
    }
    let fee = mul_div(price, u64::from(fee_bps))?;
    let rebate = mul_div(fee, u64::from(rebate_bps))?;
    let with_fee = price.checked_add(fee).ok_or(FeeError::Overflow)?;
    let total = with_fee.checked_sub(rebate).ok_or(FeeError::Overflow)?;
    let net_fee = fee.checked_sub(rebate).ok_or(FeeError::Overflow)?;
    Ok(FeeQuote {
        price,
        fee,
        rebate,
        total,
        net_fee,
    })
}

/// `bps` is buyback, ai_verification, ops, safety. The four parts must sum to 10_000.
/// Rounding dust is added to ops so the parts sum to `net_fee`.
pub fn split_fee(net_fee: u64, bps: [u16; 4]) -> Result<FeeSplit, FeeError> {
    let sum: u64 = bps.iter().map(|part| u64::from(*part)).sum();
    if sum != 10_000 {
        return Err(FeeError::Split);
    }
    let buyback = mul_div(net_fee, u64::from(bps[0]))?;
    let ai_verification = mul_div(net_fee, u64::from(bps[1]))?;
    let mut ops = mul_div(net_fee, u64::from(bps[2]))?;
    let safety = mul_div(net_fee, u64::from(bps[3]))?;
    let used = buyback
        .checked_add(ai_verification)
        .and_then(|sum| sum.checked_add(ops))
        .and_then(|sum| sum.checked_add(safety))
        .ok_or(FeeError::Overflow)?;
    let dust = net_fee.checked_sub(used).ok_or(FeeError::Overflow)?;
    ops = ops.checked_add(dust).ok_or(FeeError::Overflow)?;
    Ok(FeeSplit {
        buyback,
        ai_verification,
        ops,
        safety,
    })
}

/// `floor(amount * bps / 10_000)` in `u128`. With `bps <= 10_000` the result fits in `u64`.
fn mul_div(amount: u64, bps: u64) -> Result<u64, FeeError> {
    let product = u128::from(amount)
        .checked_mul(u128::from(bps))
        .ok_or(FeeError::Overflow)?;
    u64::try_from(product / 10_000).map_err(|_| FeeError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use proptest::strategy::Strategy;

    #[test]
    fn trencher_example() {
        let quoted = quote(1_500_000_000, 500, 6_000).unwrap();
        assert_eq!(quoted.fee, 75_000_000);
        assert_eq!(quoted.rebate, 45_000_000);
        assert_eq!(quoted.total, 1_530_000_000);
        assert_eq!(quoted.net_fee, 30_000_000);
        let split = split_fee(quoted.net_fee, [4_000, 2_500, 2_000, 1_500]).unwrap();
        assert_eq!(split.buyback, 12_000_000);
        assert_eq!(split.ai_verification, 7_500_000);
        assert_eq!(split.ops, 6_000_000);
        assert_eq!(split.safety, 4_500_000);
        assert_eq!(
            split.buyback + split.ai_verification + split.ops + split.safety,
            quoted.net_fee
        );
    }

    #[test]
    fn og_rebate_zeros_the_fee() {
        let quoted = quote(1_500_000_000, 500, 10_000).unwrap();
        assert_eq!(quoted.total, quoted.price);
        assert_eq!(quoted.net_fee, 0);
        let split = split_fee(0, [4_000, 2_500, 2_000, 1_500]).unwrap();
        assert_eq!(
            split,
            FeeSplit {
                buyback: 0,
                ai_verification: 0,
                ops: 0,
                safety: 0
            }
        );
    }

    #[test]
    fn rejects_bad_bps() {
        assert_eq!(quote(1, 10_001, 0), Err(FeeError::Bps));
        assert_eq!(split_fee(10, [1, 1, 1, 1]), Err(FeeError::Split));
    }

    #[test]
    fn rejects_rebate_bps_above_100_percent() {
        assert_eq!(quote(1, 0, 10_001), Err(FeeError::Bps));
        assert_eq!(quote(1, 10_000, 10_000).map(|q| q.total), Ok(1));
    }

    #[test]
    fn overflow_only_when_price_plus_fee_exceeds_u64() {
        assert_eq!(quote(u64::MAX, 1, 0), Err(FeeError::Overflow));
        assert_eq!(quote(u64::MAX, 10_000, 0), Err(FeeError::Overflow));
        // A full rebate still overflows: fee is added before the rebate is taken off.
        assert_eq!(quote(u64::MAX, 10_000, 10_000), Err(FeeError::Overflow));
        // Fee rounds to zero, so the largest price passes untouched.
        assert_eq!(quote(u64::MAX, 0, 0).map(|q| q.total), Ok(u64::MAX));
        assert_eq!(quote(9_999, 1, 0).map(|q| q.fee), Ok(0));
        let max = u64::MAX / 10_500 * 10_000;
        assert!(quote(max, 500, 0).is_ok());
    }

    #[test]
    fn fee_and_rebate_round_down() {
        // 19_999 * 1 / 10_000 = 1.9999 -> 1
        assert_eq!(quote(19_999, 1, 0).map(|q| q.fee), Ok(1));
        // fee 3, rebate 3 * 6_000 / 10_000 = 1.8 -> 1, so the buyer pays 2 of the fee.
        let q = quote(600, 500, 6_000).unwrap();
        assert_eq!((q.fee, q.rebate, q.net_fee, q.total), (30, 18, 12, 612));
        let q = quote(60, 500, 6_000).unwrap();
        assert_eq!((q.fee, q.rebate, q.net_fee, q.total), (3, 1, 2, 62));
    }

    #[test]
    fn split_dust_goes_to_ops() {
        let split = split_fee(7, [2_500, 2_500, 2_500, 2_500]).unwrap();
        assert_eq!(
            (
                split.buyback,
                split.ai_verification,
                split.ops,
                split.safety
            ),
            (1, 1, 4, 1)
        );
        let split = split_fee(u64::MAX, [3_333, 3_333, 3_333, 1]).unwrap();
        let sum = u128::from(split.buyback)
            + u128::from(split.ai_verification)
            + u128::from(split.ops)
            + u128::from(split.safety);
        assert_eq!(sum, u128::from(u64::MAX));
        assert_eq!(split_fee(1, [10_000, 0, 0, 0]).unwrap().buyback, 1);
        assert_eq!(split_fee(1, [0, 0, 0, 10_000]).unwrap().safety, 1);
    }

    #[test]
    fn split_rejects_sums_other_than_10_000() {
        assert_eq!(split_fee(10, [10_000, 0, 0, 1]), Err(FeeError::Split));
        assert_eq!(split_fee(10, [9_999, 0, 0, 0]), Err(FeeError::Split));
        // Summed in u64: values that would wrap in u16 are still rejected.
        assert_eq!(
            split_fee(10, [u16::MAX, 10_001, 0, 0]),
            Err(FeeError::Split)
        );
    }

    fn bps_that_sum_to_10_000() -> impl Strategy<Value = [u16; 4]> {
        (0u32..=10_000).prop_flat_map(|buyback| {
            (0u32..=10_000 - buyback).prop_flat_map(move |ai| {
                (0u32..=10_000 - buyback - ai).prop_map(move |ops| {
                    let safety = 10_000 - buyback - ai - ops;
                    [
                        u16::try_from(buyback).unwrap(),
                        u16::try_from(ai).unwrap(),
                        u16::try_from(ops).unwrap(),
                        u16::try_from(safety).unwrap(),
                    ]
                })
            })
        })
    }

    proptest! {
        #[test]
        fn split_always_sums_to_net(net in any::<u64>(), bps in bps_that_sum_to_10_000()) {
            let split = split_fee(net, bps).unwrap();
            let sum = u128::from(split.buyback)
                + u128::from(split.ai_verification)
                + u128::from(split.ops)
                + u128::from(split.safety);
            prop_assert_eq!(sum, u128::from(net));
        }

        #[test]
        fn quote_matches_exact_arithmetic(
            price in any::<u64>(),
            fee_bps in 0u16..=10_000,
            rebate_bps in 0u16..=10_000,
        ) {
            let fee = u128::from(price) * u128::from(fee_bps) / 10_000;
            let rebate = fee * u128::from(rebate_bps) / 10_000;
            let with_fee = u128::from(price) + fee;
            match quote(price, fee_bps, rebate_bps) {
                Ok(q) => {
                    prop_assert!(with_fee <= u128::from(u64::MAX));
                    prop_assert_eq!(u128::from(q.fee), fee);
                    prop_assert_eq!(u128::from(q.rebate), rebate);
                    prop_assert!(q.rebate <= q.fee);
                    prop_assert_eq!(q.net_fee, q.fee - q.rebate);
                    prop_assert_eq!(u128::from(q.total), u128::from(price) + fee - rebate);
                    prop_assert_eq!(q.total, q.price + q.net_fee);
                }
                Err(e) => {
                    prop_assert_eq!(e, FeeError::Overflow);
                    prop_assert!(with_fee > u128::from(u64::MAX));
                }
            }
        }

        #[test]
        fn quote_rejects_any_bps_over_100_percent(
            price in any::<u64>(),
            fee_bps in 10_001u16..,
            rebate_bps in any::<u16>(),
        ) {
            prop_assert_eq!(quote(price, fee_bps, rebate_bps), Err(FeeError::Bps));
            prop_assert_eq!(quote(price, rebate_bps % 10_001, fee_bps), Err(FeeError::Bps));
        }
    }
}
