import SwiftUI

enum PaletteChoice: String, CaseIterable, Identifiable {
    case auto, clear, warm, dusk
    var id: String { rawValue }
    var label: String {
        switch self {
        case .auto: return "Auto"
        case .clear: return "Clear"
        case .warm: return "Warm"
        case .dusk: return "Dusk"
        }
    }
}

enum PaletteId: String {
    case clear, warm, dusk
}

struct Palette {
    var bgTop: Color
    var bg: Color
    var surface: Color
    var ink: Color
    var muted: Color
    var accent: Color
    var accentSoft: Color
    var border: Color
    var danger: Color

    static let clear = Palette(
        bgTop: Color(red: 0.835, green: 0.906, blue: 1),
        bg: Color(red: 0.953, green: 0.969, blue: 0.988),
        surface: .white,
        ink: Color(red: 0.118, green: 0.141, blue: 0.188),
        muted: Color(red: 0.365, green: 0.420, blue: 0.502),
        accent: Color(red: 0.184, green: 0.357, blue: 0.827),
        accentSoft: Color(red: 0.906, green: 0.937, blue: 1),
        border: Color(red: 0.835, green: 0.871, blue: 0.918),
        danger: Color(red: 0.753, green: 0.224, blue: 0.169)
    )
    static let warm = Palette(
        bgTop: Color(red: 1, green: 0.843, blue: 0.682),
        bg: Color(red: 0.984, green: 0.965, blue: 0.937),
        surface: Color(red: 1, green: 0.992, blue: 0.976),
        ink: Color(red: 0.173, green: 0.149, blue: 0.122),
        muted: Color(red: 0.478, green: 0.427, blue: 0.376),
        accent: Color(red: 0.055, green: 0.486, blue: 0.420),
        accentSoft: Color(red: 0.898, green: 0.961, blue: 0.945),
        border: Color(red: 0.918, green: 0.875, blue: 0.824),
        danger: Color(red: 0.753, green: 0.224, blue: 0.169)
    )
    static let dusk = Palette(
        bgTop: Color(red: 0.804, green: 0.792, blue: 0.961),
        bg: Color(red: 0.957, green: 0.949, blue: 0.973),
        surface: Color(red: 1, green: 0.988, blue: 1),
        ink: Color(red: 0.149, green: 0.141, blue: 0.227),
        muted: Color(red: 0.427, green: 0.408, blue: 0.502),
        accent: Color(red: 0.353, green: 0.275, blue: 0.784),
        accentSoft: Color(red: 0.933, green: 0.914, blue: 1),
        border: Color(red: 0.878, green: 0.859, blue: 0.918),
        danger: Color(red: 0.753, green: 0.224, blue: 0.169)
    )

    static func id(for choice: PaletteChoice, now: Date = Date()) -> PaletteId {
        if choice != .auto {
            return PaletteId(rawValue: choice.rawValue) ?? .clear
        }
        let hour = Calendar.current.component(.hour, from: now)
        if hour >= 5 && hour < 11 { return .warm }
        if hour >= 11 && hour < 17 { return .clear }
        return .dusk
    }

    static func resolve(_ choice: PaletteChoice, now: Date = Date()) -> Palette {
        switch id(for: choice, now: now) {
        case .clear: return .clear
        case .warm: return .warm
        case .dusk: return .dusk
        }
    }
}

enum BucketColor {
    static func components(_ hex: String) -> (Double, Double, Double)? {
        var raw = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("#") { raw.removeFirst() }
        guard raw.count == 6, let value = Int(raw, radix: 16) else { return nil }
        return (
            Double((value >> 16) & 0xFF) / 255,
            Double((value >> 8) & 0xFF) / 255,
            Double(value & 0xFF) / 255
        )
    }

    static func mix(_ a: (Double, Double, Double), _ b: (Double, Double, Double), towardB: Double) -> Color {
        Color(
            red: a.0 + (b.0 - a.0) * towardB,
            green: a.1 + (b.1 - a.1) * towardB,
            blue: a.2 + (b.2 - a.2) * towardB
        )
    }

    static func readable(_ rgb: (Double, Double, Double)) -> Color {
        let lum = 0.2126 * rgb.0 + 0.7152 * rgb.1 + 0.0722 * rgb.2
        if lum > 0.62 { return mix(rgb, (0.12, 0.12, 0.14), towardB: 0.45) }
        return Color(red: rgb.0, green: rgb.1, blue: rgb.2)
    }
}

extension Palette {
    /// Wash the screen with a bucket color. Light colors get darkened so buttons stay readable.
    func tinted(with hex: String) -> Palette {
        guard let rgb = BucketColor.components(hex) else { return self }
        var copy = self
        copy.accent = BucketColor.readable(rgb)
        copy.accentSoft = BucketColor.mix(rgb, (1, 1, 1), towardB: 0.82)
        copy.bgTop = BucketColor.mix(rgb, (1, 1, 1), towardB: 0.5)
        copy.bg = BucketColor.mix(rgb, (0.97, 0.97, 0.98), towardB: 0.88)
        return copy
    }
}

private struct PaletteKey: EnvironmentKey {
    static let defaultValue = Palette.clear
}

extension EnvironmentValues {
    var palette: Palette {
        get { self[PaletteKey.self] }
        set { self[PaletteKey.self] = newValue }
    }
}
