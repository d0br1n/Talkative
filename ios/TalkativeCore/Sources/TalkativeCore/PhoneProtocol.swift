import Foundation

public let phoneProtocolVersion = 1
public let maxPhoneMessageBytes = 60_000

public enum Verbosity: String, Codable, CaseIterable { case brief, normal, full }
public enum Effort: String, Codable, CaseIterable { case `default` = "default", low, medium, high }
public enum PhoneModel: String, Codable, CaseIterable { case haiku, sonnet, opus }
public enum PhoneCommand: String, Codable { case stop, newConversation = "new conversation", quiet }
public enum LogLevel: String, Codable { case info, error }
public enum DecidedBy: String { case owner, timeout }

public struct PhoneProtocolError: Error, Equatable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public init(message: String) { self.message = message }
}

public enum ToPhone: Equatable {
    case heard(text: String)
    case blockStart(turnId: String, block: Int)
    case blockEnd(turnId: String, block: Int)
    case delta(turnId: String, block: Int, text: String)
    case sentence(turnId: String, index: Int, text: String)
    case speaking(turnId: String, index: Int)
    case narration(text: String)
    case status(agent: AgentHealth, thinking: Bool, jobs: Int, audio: Bool)
    case error(text: String)
    case approval(id: String, tool: String, summary: String, detail: String, expiresAt: Int64)
    case approvalDone(id: String, allow: Bool, by: DecidedBy)
    case settings(verbosity: Verbosity, model: String, effort: Effort)
}

public enum FromPhone: Equatable {
    case hello(protocol: Int)
    case mic(on: Bool)
    case audio(on: Bool)
    case said(text: String)
    case decide(id: String, allow: Bool)
    case settings(verbosity: Verbosity?, model: PhoneModel?, effort: Effort?)
    case command(PhoneCommand)
    case log(level: LogLevel, text: String)
}

public enum PhoneCodec {
    public static func decodeToPhone(_ data: Data) throws -> ToPhone {
        let r = try Reader(data)
        switch r.type {
        case "heard": return .heard(text: try r.string("text"))
        case "blockStart": return .blockStart(turnId: try r.string("turnId"), block: try r.int("block"))
        case "blockEnd": return .blockEnd(turnId: try r.string("turnId"), block: try r.int("block"))
        case "delta":
            return .delta(turnId: try r.string("turnId"), block: try r.int("block"), text: try r.string("text"))
        case "sentence":
            return .sentence(turnId: try r.string("turnId"), index: try r.int("index"), text: try r.string("text"))
        case "speaking": return .speaking(turnId: try r.string("turnId"), index: try r.int("index"))
        case "narration": return .narration(text: try r.string("text"))
        case "status":
            return .status(agent: try r.enumValue("agent"), thinking: try r.bool("thinking"),
                           jobs: try r.int("jobs"), audio: try r.bool("audio"))
        case "error": return .error(text: try r.string("text"))
        case "settings":
            return .settings(verbosity: try r.enumValue("verbosity"), model: try r.string("model"),
                             effort: try r.enumValue("effort"))
        case "approval":
            return .approval(id: try r.string("id"), tool: try r.string("tool"), summary: try r.string("summary"),
                             detail: try r.string("detail"), expiresAt: try r.int64("expiresAt"))
        case "approvalDone":
            return .approvalDone(id: try r.string("id"), allow: try r.bool("allow"), by: try r.enumValue("by"))
        default: throw PhoneProtocolError("unknown message type: \(r.type)")
        }
    }

    public static func decodeFromPhone(_ data: Data) throws -> FromPhone {
        let r = try Reader(data)
        switch r.type {
        case "hello": return .hello(protocol: try r.int("protocol"))
        case "mic": return .mic(on: try r.bool("on"))
        case "audio": return .audio(on: try r.bool("on"))
        case "said": return .said(text: try r.string("text"))
        case "decide": return .decide(id: try r.string("id"), allow: try r.bool("allow"))
        case "settings":
            return .settings(verbosity: try r.optionalEnum("verbosity"), model: try r.optionalEnum("model"),
                             effort: try r.optionalEnum("effort"))
        case "command": return .command(try r.enumValue("name"))
        case "log": return .log(level: try r.enumValue("level"), text: try r.string("text"))
        default: throw PhoneProtocolError("unknown message type: \(r.type)")
        }
    }

    public static func encode(_ m: FromPhone) throws -> Data {
        var o: [String: Any]
        switch m {
        case .hello(let p): o = ["t": "hello", "protocol": p]
        case .mic(let on): o = ["t": "mic", "on": on]
        case .audio(let on): o = ["t": "audio", "on": on]
        case .said(let text): o = ["t": "said", "text": text]
        case .decide(let id, let allow): o = ["t": "decide", "id": id, "allow": allow]
        case .settings(let v, let mo, let e):
            o = ["t": "settings"]
            if let v { o["verbosity"] = v.rawValue }
            if let mo { o["model"] = mo.rawValue }
            if let e { o["effort"] = e.rawValue }
        case .command(let c): o = ["t": "command", "name": c.rawValue]
        case .log(let l, let text): o = ["t": "log", "level": l.rawValue, "text": text]
        }
        return try serialize(o)
    }

    public static func encode(_ m: ToPhone) throws -> Data {
        let o: [String: Any]
        switch m {
        case .heard(let text): o = ["t": "heard", "text": text]
        case .blockStart(let id, let b): o = ["t": "blockStart", "turnId": id, "block": b]
        case .blockEnd(let id, let b): o = ["t": "blockEnd", "turnId": id, "block": b]
        case .delta(let id, let b, let text): o = ["t": "delta", "turnId": id, "block": b, "text": text]
        case .sentence(let id, let i, let text): o = ["t": "sentence", "turnId": id, "index": i, "text": text]
        case .speaking(let id, let i): o = ["t": "speaking", "turnId": id, "index": i]
        case .narration(let text): o = ["t": "narration", "text": text]
        case .status(let a, let th, let j, let au):
            o = ["t": "status", "agent": a.rawValue, "thinking": th, "jobs": j, "audio": au]
        case .error(let text): o = ["t": "error", "text": text]
        case .approval(let id, let tool, let s, let d, let e):
            o = ["t": "approval", "id": id, "tool": tool, "summary": s, "detail": d, "expiresAt": e]
        case .approvalDone(let id, let allow, let by):
            o = ["t": "approvalDone", "id": id, "allow": allow, "by": by.rawValue]
        case .settings(let v, let m, let e):
            o = ["t": "settings", "verbosity": v.rawValue, "model": m, "effort": e.rawValue]
        }
        return try serialize(o)
    }

    private static func serialize(_ o: [String: Any]) throws -> Data {
        let data = try JSONSerialization.data(withJSONObject: o, options: [.sortedKeys, .withoutEscapingSlashes])
        if data.count > maxPhoneMessageBytes {
            throw PhoneProtocolError("message exceeds \(maxPhoneMessageBytes) bytes")
        }
        return data
    }
}

/// Field access that mirrors `src/shared/validate.ts`: extra fields are ignored,
/// a boolean is never a number and a number is never a boolean.
private struct Reader {
    let type: String
    let obj: [String: Any]

    init(_ data: Data) throws {
        let any: Any
        do { any = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) }
        catch { throw PhoneProtocolError("malformed JSON") }
        guard let o = any as? [String: Any] else { throw PhoneProtocolError("message is not an object") }
        guard let t = o["t"] as? String else { throw PhoneProtocolError("unknown message type: \(String(describing: o["t"]))") }
        obj = o
        type = t
    }

    private static func isBool(_ v: Any) -> Bool {
        if v is Bool && !(v is NSNumber) { return true }
        if let n = v as? NSNumber { return String(cString: n.objCType) == "c" }
        return false
    }

    private func value(_ k: String) throws -> Any {
        guard let v = obj[k], !(v is NSNull) else { throw PhoneProtocolError("\(type): missing field \(k)") }
        return v
    }

    func string(_ k: String) throws -> String {
        guard let s = try value(k) as? String else { throw PhoneProtocolError("\(type): bad field \(k)") }
        return s
    }

    func bool(_ k: String) throws -> Bool {
        let v = try value(k)
        guard Reader.isBool(v), let b = v as? Bool else { throw PhoneProtocolError("\(type): bad field \(k)") }
        return b
    }

    /// A JSON number that is a whole value; 1.5 is a number in TypeScript but has no Int form, so it throws.
    func int64(_ k: String) throws -> Int64 {
        let v = try value(k)
        guard !Reader.isBool(v), let n = v as? NSNumber else { throw PhoneProtocolError("\(type): bad field \(k)") }
        let d = n.doubleValue
        guard d == d.rounded(), abs(d) < 9.0e18 else { throw PhoneProtocolError("\(type): bad field \(k)") }
        return n.int64Value
    }

    func int(_ k: String) throws -> Int { Int(try int64(k)) }

    func enumValue<E: RawRepresentable>(_ k: String) throws -> E where E.RawValue == String {
        guard let e = E(rawValue: try string(k)) else { throw PhoneProtocolError("\(type): bad field \(k)") }
        return e
    }

    func optionalEnum<E: RawRepresentable>(_ k: String) throws -> E? where E.RawValue == String {
        guard let v = obj[k] else { return nil }
        guard let s = v as? String, let e = E(rawValue: s) else { throw PhoneProtocolError("\(type): bad field \(k)") }
        return e
    }
}
