import ActivityKit
import SwiftUI
import WidgetKit

struct TaskLiveWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TaskActivityAttributes.self) { context in
            TaskLiveLockView(context: context)
                .widgetURL(taskURL(context.attributes.taskId))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.title)
                        .font(.headline)
                        .lineLimit(2)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: context.state.startedAt...Date.distantFuture, countsDown: false)
                        .font(.caption.monospacedDigit())
                        .frame(maxWidth: 56)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        if let range = estimateRange(context) {
                            ProgressView(timerInterval: range, countsDown: false)
                        }
                        HStack {
                            Button(intent: StopLiveTaskIntent()) { Text("Stop") }
                            Button(intent: CompleteLiveTaskIntent(taskId: context.attributes.taskId)) { Text("Done") }
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: "circle.dashed")
            } compactTrailing: {
                Text(timerInterval: context.state.startedAt...Date.distantFuture, countsDown: false)
                    .monospacedDigit()
                    .frame(maxWidth: 44)
            } minimal: {
                Image(systemName: "circle.dashed")
            }
            .widgetURL(taskURL(context.attributes.taskId))
        }
    }
}

private struct TaskLiveLockView: View {
    let context: ActivityViewContext<TaskActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(context.attributes.title)
                .font(.headline)
                .lineLimit(2)
            HStack(spacing: 6) {
                Text(timerInterval: context.state.startedAt...Date.distantFuture, countsDown: false)
                    .monospacedDigit()
                if let minutes = context.attributes.estimateMinutes, minutes > 0 {
                    Text("· about \(minutes)m")
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            if let range = estimateRange(context) {
                ProgressView(timerInterval: range, countsDown: false)
                    .tint(accent)
            }
            HStack {
                Button(intent: StopLiveTaskIntent()) { Text("Stop") }
                Button(intent: CompleteLiveTaskIntent(taskId: context.attributes.taskId)) { Text("Done") }
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .activityBackgroundTint(Color(red: 0.953, green: 0.969, blue: 0.988))
    }

    private var accent: Color {
        Color(liveHex: context.attributes.accentHex) ?? Color(red: 0.184, green: 0.357, blue: 0.827)
    }
}

private func taskURL(_ id: String) -> URL? {
    URL(string: "taskr://task/\(id)")
}

private func estimateRange(_ context: ActivityViewContext<TaskActivityAttributes>) -> ClosedRange<Date>? {
    guard let minutes = context.attributes.estimateMinutes, minutes > 0 else { return nil }
    let end = context.state.startedAt.addingTimeInterval(TimeInterval(minutes * 60))
    guard end > context.state.startedAt else { return nil }
    return context.state.startedAt...end
}

private extension Color {
    init?(liveHex: String) {
        var raw = liveHex.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("#") { raw.removeFirst() }
        guard raw.count == 6, let value = Int(raw, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
