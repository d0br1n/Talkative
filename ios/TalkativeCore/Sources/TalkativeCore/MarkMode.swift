import Foundation

public enum AgentHealth: String {
    case ready, restarting, down
}

public enum MarkMode: Equatable {
    case listening, thinking, speaking, down

    public static func select(connected: Bool, agent: AgentHealth, thinking: Bool,
                              outputRMS: Double, micRMS: Double, micOn: Bool) -> MarkMode {
        if !connected || agent == .down { return .down }
        if outputRMS > 0.01 { return .speaking }
        if micOn && micRMS > 0.01 { return .listening }
        if thinking { return .thinking }
        return .listening
    }

    /// With the mic off, listening is flat: the mic tap may still hear a muted input.
    public static func bars(mode: MarkMode, t: Double, output: [Double], mic: [Double], micOn: Bool) -> [Double] {
        switch mode {
        case .speaking: return output
        case .listening: return micOn ? mic : Array(repeating: 0, count: MarkRenderer.bars)
        case .thinking: return MarkRenderer.idleBars(t: t * 0.35, level: 0.22)
        case .down: return MarkRenderer.idleBars(t: 0, level: 0.1)
        }
    }
}
