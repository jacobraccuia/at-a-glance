import SwiftUI

/// One drifting glow per persona. It swells with the mic, and brighter once she can hear.
struct PersonaOrb: View {
    let name: String
    var level: Double
    var live: Bool
    var speaking: Bool
    var mini = false

    var body: some View {
        let look = PersonaLook.of(name)
        let size: CGFloat = mini ? 34 : 176
        TimelineView(.animation) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            let swell = 1 + (speaking ? 0.08 : 0) + level * (live ? 0.22 : 0.07)
            ZStack {
                blob(look.core, time: time, speed: look.speed, phase: 0, reach: mini ? 3 : 14, scale: swell, size: size)
                blob(look.glow, time: time, speed: look.speed * 1.25, phase: 1.4, reach: mini ? 4 : 18, scale: swell * 0.9, size: size)
                blob(look.core.opacity(0.75), time: time, speed: look.speed * 0.8, phase: 2.6, reach: mini ? 2 : 12, scale: swell * 0.82, size: size)
            }
            .frame(width: size, height: size)
            .opacity(live ? 1 : 0.72)
        }
        .accessibilityHidden(true)
    }

    private func blob(_ color: Color, time: Double, speed: Double, phase: Double, reach: CGFloat, scale: Double, size: CGFloat) -> some View {
        Circle()
            .fill(color)
            .frame(width: size * 0.62, height: size * 0.62)
            .blur(radius: mini ? 4 : 16)
            .scaleEffect(scale)
            .offset(
                x: CGFloat(sin(time * speed + phase)) * reach,
                y: CGFloat(cos(time * speed * 0.85 + phase)) * reach
            )
    }
}

private struct PersonaLook {
    let core: Color
    let glow: Color
    let speed: Double

    static func of(_ name: String) -> PersonaLook {
        switch name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "atlas":
            return PersonaLook(core: Color(red: 0.18, green: 0.38, blue: 0.50), glow: Color(red: 0.72, green: 0.86, blue: 0.92), speed: 0.55)
        case "sage":
            return PersonaLook(core: Color(red: 0.72, green: 0.52, blue: 0.22), glow: Color(red: 0.95, green: 0.86, blue: 0.62), speed: 0.7)
        case "mercury":
            return PersonaLook(core: Color(red: 0.95, green: 0.38, blue: 0.22), glow: Color(red: 1, green: 0.78, blue: 0.55), speed: 1.35)
        case "logos":
            return PersonaLook(core: Color(red: 0.36, green: 0.42, blue: 0.46), glow: Color(red: 0.82, green: 0.86, blue: 0.88), speed: 0.4)
        default:
            return PersonaLook(core: Color(red: 0.48, green: 0.30, blue: 1), glow: Color(red: 0.95, green: 0.82, blue: 1), speed: 1.05)
        }
    }
}
