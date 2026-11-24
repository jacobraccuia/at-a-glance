import SwiftUI
import WidgetKit

struct TodayEntry: TimelineEntry {
    let date: Date
    let glance: TodayGlance
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), glance: TodayGlance(
            day: "",
            count: 2,
            easyTitle: "Water the plants",
            easyMinutes: 5,
            easyId: nil,
            titles: ["Water the plants", "Reply to the promoter"],
            accentHex: "#2f5bd3"
        ))
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        let glance = TodayGlance.read()
        completion(TodayEntry(date: Date(), glance: glance.count == 0 && glance.easyTitle == nil ? placeholder(in: context).glance : glance))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        Task {
            let glance = await TodayGlance.current()
            let entry = TodayEntry(date: Date(), glance: glance)
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let glance: TodayGlance

    private var accent: Color { Color(hex: glance.accentHex) ?? Color(red: 0.184, green: 0.357, blue: 0.827) }

    var body: some View {
        content
            .containerBackground(Color(red: 0.953, green: 0.969, blue: 0.988), for: .widget)
            .widgetURL(URL(string: "taskr://today"))
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .accessoryCircular:
            VStack(spacing: 0) {
                Text("\(glance.count)")
                    .font(.headline)
                Text("today")
                    .font(.caption2)
            }
        case .accessoryInline:
            Text(inline)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text(headline).font(.headline)
                Text(detail).font(.caption)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .systemMedium:
            VStack(alignment: .leading, spacing: 6) {
                Text(headline).font(.headline).foregroundStyle(accent)
                if glance.titles.isEmpty {
                    Text("Nothing waiting.").foregroundStyle(.secondary)
                } else {
                    ForEach(glance.titles, id: \.self) { title in
                        Text(title).font(.subheadline).lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        default:
            VStack(alignment: .leading, spacing: 6) {
                Text(headline).font(.headline).foregroundStyle(accent)
                Text(detail).font(.subheadline).lineLimit(3)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private var headline: String {
        glance.count == 0 ? "Today is clear" : "\(glance.count) today"
    }

    private var detail: String {
        guard let easy = glance.easyTitle, glance.count > 0 else { return "Nothing waiting." }
        if let minutes = glance.easyMinutes { return "\(easy) · \(minutes)m" }
        return easy
    }

    private var inline: String {
        if let easy = glance.easyTitle, glance.count > 0 { return "\(glance.count) today · \(easy)" }
        return glance.count == 0 ? "Today is clear" : "\(glance.count) today"
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Today", provider: TodayProvider()) { entry in
            TodayWidgetView(glance: entry.glance)
        }
        .configurationDisplayName("Today")
        .description("The next easy thing, and how many are left.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryRectangular,
            .accessoryCircular,
            .accessoryInline,
        ])
    }
}

@main
struct TaskrWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        TaskLiveWidget()
    }
}

private extension Color {
    init?(hex: String) {
        var raw = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("#") { raw.removeFirst() }
        guard raw.count == 6, let value = Int(raw, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
