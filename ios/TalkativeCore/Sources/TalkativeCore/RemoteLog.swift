import Foundation

/// A bounded buffer of log lines the phone sends to the voice side.
public final class RemoteLog {
    private let capacity: Int
    private let maxLineBytes: Int
    private let lock = NSLock()
    private var lines: [(LogLevel, String)] = []
    private var dropped = 0

    public init(capacity: Int = 200, maxLineBytes: Int = 2048) {
        self.capacity = max(1, capacity)
        self.maxLineBytes = maxLineBytes
    }

    public func add(_ level: LogLevel, _ text: String) {
        let line = RemoteLog.cut(text, toBytes: maxLineBytes)
        lock.lock(); defer { lock.unlock() }
        if lines.count >= capacity {
            lines.removeFirst()
            dropped += 1
        }
        lines.append((level, line))
    }

    public func drain() -> [FromPhone] {
        lock.lock(); defer { lock.unlock() }
        var out: [FromPhone] = []
        if dropped > 0 { out.append(.log(level: .info, text: "… \(dropped) earlier lines dropped")) }
        out += lines.map { .log(level: $0.0, text: $0.1) }
        lines = []
        dropped = 0
        return out
    }

    private static func cut(_ s: String, toBytes max: Int) -> String {
        if s.utf8.count <= max { return s }
        var out = ""
        var used = 0
        for ch in s {
            let n = String(ch).utf8.count
            if used + n > max { break }
            out.append(ch)
            used += n
        }
        return out
    }
}
