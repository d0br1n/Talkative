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

    public static func bars(mode: MarkMode, t: Double, output: [Double], mic: [Double]) -> [Double] {
        switch mode {
        case .speaking: return output
        case .listening: return mic
        case .thinking: return MarkRenderer.idleBars(t: t * 0.35, level: 0.22)
        case .down: return MarkRenderer.idleBars(t: 0, level: 0.1)
        }
    }
}
