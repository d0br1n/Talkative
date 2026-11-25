import Foundation

public enum StatusLine {
    public static func text(_ s: ConversationState) -> String {
        var line: String
        switch s.connection {
        case .connecting: line = "… connecting"
        case .reconnecting: line = "… reconnecting"
        case .idle, .left: line = "✕ not connected"
        case .expired: line = "✕ pairing expired"
        case .connected:
            if s.agent == .down { line = "✕ agent down" }
            else if s.agent == .restarting { line = "◌ restarting" }
            else if !s.approvals.isEmpty { line = "▲ waiting for you" }
            else if s.thinking { line = "▲ thinking" }
            else { line = "● listening" }
        }
        if s.jobs > 0, s.connection == .connected { line += s.jobs == 1 ? " · 1 job running" : " · \(s.jobs) jobs running" }
        if !s.audio { line += " · ♪ off" }
        return line
    }
}
