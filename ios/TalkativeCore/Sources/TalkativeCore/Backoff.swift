import Foundation

/// The wait before each rejoin after an unexpected disconnect: 1, 2, 4, 8, 16 s, then 30 s for ever.
public enum Backoff {
    public static let maxDelay: TimeInterval = 30

    /// `attempt` counts from 0 (the first retry).
    public static func delay(attempt: Int) -> TimeInterval {
        let n = max(0, attempt)
        if n >= 5 { return maxDelay }
        return min(maxDelay, TimeInterval(1 << n))
    }
}
