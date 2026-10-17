//! Integer fee math. Matches `packages/shared/src/fee.ts`: floor division, dust to ops.

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
    }
}
