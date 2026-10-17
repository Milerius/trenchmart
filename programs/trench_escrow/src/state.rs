//! Order transitions. Same edges as `packages/shared/src/state.ts`.

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
