//! Order transitions. Same edges as `packages/shared/src/state.ts`.
//!
//! Security-relevant shape: `Refunded` and `Expired` are terminal (no edge out), so funds can
//! leave an escrow at most once. `Disputed -> Released` exists only so `reject_dispute` can
//! restore a dispute opened after release; `release` itself additionally requires `Paid`.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Pending,
    Paid,
    Released,
    Refunded,
    Disputed,
    Expired,
}

pub fn can_transition(from: Status, to: Status) -> bool {
    matches!(
        (from, to),
        (Status::Pending, Status::Paid)
            | (Status::Pending, Status::Expired)
            | (Status::Paid, Status::Released)
            | (Status::Paid, Status::Disputed)
            | (Status::Disputed, Status::Refunded)
            | (Status::Disputed, Status::Paid)
            | (Status::Disputed, Status::Released)
            | (Status::Released, Status::Disputed)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [Status; 6] = [
        Status::Pending,
        Status::Paid,
        Status::Released,
        Status::Refunded,
        Status::Disputed,
        Status::Expired,
    ];

    #[test]
    fn every_valid_edge() {
        let valid = [
            (Status::Pending, Status::Paid),
            (Status::Pending, Status::Expired),
            (Status::Paid, Status::Released),
            (Status::Paid, Status::Disputed),
            (Status::Disputed, Status::Refunded),
            (Status::Disputed, Status::Paid),
            (Status::Disputed, Status::Released),
            (Status::Released, Status::Disputed),
        ];
        for (from, to) in valid {
            assert!(can_transition(from, to), "{from:?} -> {to:?}");
        }
    }

    /// The complete 6x6 table, written out by hand so a new edge cannot slip in unnoticed.
    #[test]
    fn transition_table_is_exactly_the_documented_one() {
        use Status::*;
        let allowed: [[bool; 6]; 6] = [
            // to: Pending Paid  Released Refunded Disputed Expired
            [false, true, false, false, false, true], // from Pending
            [false, false, true, false, true, false], // from Paid
            [false, false, false, false, true, false], // from Released
            [false, false, false, false, false, false], // from Refunded
            [false, true, true, true, false, false],  // from Disputed
            [false, false, false, false, false, false], // from Expired
        ];
        let order = [Pending, Paid, Released, Refunded, Disputed, Expired];
        for (i, from) in order.iter().enumerate() {
            for (j, to) in order.iter().enumerate() {
                assert_eq!(
                    can_transition(*from, *to),
                    allowed[i][j],
                    "{from:?} -> {to:?}"
                );
            }
        }
    }

    #[test]
    fn every_invalid_edge() {
        for from in ALL {
            for to in ALL {
                let valid = can_transition(from, to);
                if valid {
                    continue;
                }
                assert!(!can_transition(from, to), "{from:?} -> {to:?}");
            }
        }
        assert!(!can_transition(Status::Refunded, Status::Paid));
        assert!(!can_transition(Status::Expired, Status::Paid));
        assert!(!can_transition(Status::Pending, Status::Released));
        assert!(!can_transition(Status::Paid, Status::Refunded));
        assert!(!can_transition(Status::Released, Status::Refunded));
    }
}
