pub const SEED_CAMPAIGN: &[u8] = b"campaign";
pub const SEED_CHANNEL: &[u8] = b"channel";
pub const SEED_XLINK: &[u8] = b"xlink";
pub const SEED_XCLAIM: &[u8] = b"xclaim";
pub const SEED_CHANNEL_X: &[u8] = b"channel_x";

/// The longest a campaign can ask a converted wallet to stay: 180 days.
pub const MAX_RETENTION_SECS: u32 = 180 * 86_400;

/// The least time the settler is guaranteed between the last wallet's
/// retention window closing and the settle deadline. Without it an advertiser
/// could set a deadline the settler cannot meet and refund money that
/// channels had earned.
pub const MIN_SETTLE_GRACE: i64 = 3_600;

/// X handles are 1 to 15 characters of letters, digits and underscores.
pub const MAX_HANDLE: usize = 15;
