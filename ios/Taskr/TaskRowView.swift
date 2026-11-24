import SwiftUI

struct TaskRowView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    let task: TaskItem
    var showAdd: Bool
    var onChange: () async -> Void
    var onClear: () -> Void = {}
    var onOpen: () -> Void

    @State private var poof = false
    @State private var dragX: CGFloat = 0

    private var canToday: Bool {
        showAdd && task.recurrenceRuleId == nil && !ISO8601.isToday(task.attentionDate)
    }

    private var rightLabel: String {
        if canToday {
            if dragX >= 230 { return "Next week" }
            if dragX >= 150 { return "Tomorrow" }
            return "Today"
        }
        return dragX >= 168 ? "Next week" : "Tomorrow"
    }

    var body: some View {
        ZStack {
            swipeBackdrop
            rowBody
                .offset(x: dragX)
                .gesture(rowSwipe)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .animation(dragX == 0 ? .easeOut(duration: 0.2) : nil, value: dragX)
    }

    private var swipeBackdrop: some View {
        HStack {
            if dragX > 12 {
                Image(systemName: "clock")
                Text(rightLabel)
                    .font(.caption.weight(.semibold))
                Spacer()
            }
            if dragX < -12 {
                Spacer()
                Image(systemName: "checkmark")
                Text("Done").font(.caption.weight(.semibold))
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(dragX < 0 ? palette.accent : Color(red: 0.72, green: 0.45, blue: 0.12))
    }

    private var rowSwipe: some Gesture {
        DragGesture(minimumDistance: 18, coordinateSpace: .local)
            .onChanged { value in
                guard task.status != .completed, !poof else { return }
                let dx = value.translation.width
                let dy = value.translation.height
                guard abs(dx) > abs(dy) else { return }
                let limit: CGFloat = canToday ? 300 : 220
                dragX = min(limit, max(-limit, dx))
            }
            .onEnded { _ in
                let x = dragX
                dragX = 0
                guard task.status != .completed else { return }
                if x <= -76 { Task { await toggle() } }
                else if canToday {
                    if x >= 230 { Task { await move("nextWeek") } }
                    else if x >= 150 { Task { await move("tomorrow") } }
                    else if x >= 76 { Task { await move("today") } }
                } else if x >= 168 { Task { await move("nextWeek") } }
                else if x >= 76 { Task { await move("tomorrow") } }
            }
    }

    private var rowBody: some View {
        HStack(alignment: .center, spacing: 10) {
            Button {
                Task { await toggle() }
            } label: {
                Image(systemName: task.status == .completed || poof ? "checkmark" : "circle")
                    .font(.title3)
                    .foregroundStyle(task.status == .completed || poof ? Color.white : palette.muted)
                    .frame(width: 32, height: 32)
                    .background(task.status == .completed || poof ? palette.accent : Color.clear)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(poof || task.status == .completed ? palette.accent : palette.border, lineWidth: 1.5))
                    .scaleEffect(poof ? 1.15 : 1)
            }
            .accessibilityLabel(task.status == .completed ? "Mark not done" : "Mark done")

            VStack(alignment: .leading, spacing: 4) {
                Text(task.title)
                    .strikethrough(task.status == .completed)
                    .foregroundStyle(task.status == .completed ? palette.muted : palette.ink)
                meta
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture { onOpen() }

            if task.status != .completed {
                icon("clock", label: "Tomorrow") { Task { await move("tomorrow") } }
                icon("tray", label: "Later") { Task { await move("later") } }
                icon("trash", label: "Drop") { Task { await drop() } }
            }
        }
        .padding(10)
        .background(palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(palette.border))
        .overlay { if poof { SparkleBurst().allowsHitTesting(false) } }
        .opacity(poof ? 0.15 : 1)
        .offset(y: poof ? -10 : 0)
        .animation(.easeOut(duration: 0.55), value: poof)
    }

    private var meta: some View {
        HStack(spacing: 6) {
            if let name = task.bucket?.name {
                pill(name)
            }
                if task.importance == .high { pill("Important") }
                if let effort = task.effort { pill("\(effort.label) effort") }
                if let due = task.hardDeadline, let date = ISO8601.date(due) {
                    pill("Due \(date.formatted(date: .abbreviated, time: .omitted))")
                }
                if let wait = task.waitingOn, !wait.isEmpty { pill("Waiting: \(wait)") }
                if let minutes = task.estimateMinutes { pill("~\(minutes)m") }
                if task.status == .completed, let span = ISO8601.doneIn(from: task.createdAt, to: task.completedAt) {
                    pill(span)
                }
                if let notes = task.notes, !notes.isEmpty { pill("Has notes") }
        }
        .font(.caption2)
    }

    private func pill(_ text: String) -> some View {
        Text(text)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(palette.accentSoft)
            .clipShape(Capsule())
    }

    private func icon(_ name: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name)
                .font(.caption)
                .frame(width: 28, height: 28)
                .foregroundStyle(name == "trash" ? palette.danger : palette.muted)
        }
        .accessibilityLabel(label)
    }

    private func toggle() async {
        if task.status == .completed {
            try? await model.api.postVoid("tasks/\(task.id)/undo")
            await onChange()
            return
        }
        poof = true
        onClear()
        try? await Task.sleep(nanoseconds: 520_000_000)
        do {
            try await model.api.postVoid("tasks/\(task.id)/complete")
            await TaskActivity.stop(taskId: task.id)
        } catch {}
        await onChange()
    }

    private func move(_ horizon: String) async {
        struct Body: Encodable { let horizon: String }
        onClear()
        do {
            try await model.api.postVoid("tasks/\(task.id)/horizon", body: Body(horizon: horizon))
            await TaskActivity.stop(taskId: task.id)
        } catch {}
        await onChange()
    }

    private func drop() async {
        onClear()
        do {
            try await model.api.postVoid("tasks/\(task.id)/drop")
            await TaskActivity.stop(taskId: task.id)
        } catch {}
        await onChange()
    }

}

struct OccurrenceRowView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    let occurrence: TaskOccurrence
    var onChange: () async -> Void
    var onClear: () -> Void = {}
    @State private var poof = false

    var body: some View {
        HStack {
            Button {
                Task { await toggle() }
            } label: {
                Image(systemName: occurrence.status == .completed || poof ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(palette.accent)
            }
            VStack(alignment: .leading) {
                Text(occurrence.task?.title ?? "Recurring")
                Text(occurrence.status == .completed ? (ISO8601.doneIn(from: occurrence.createdAt, to: occurrence.completedAt) ?? "Recurring") : "Recurring")
                    .font(.caption2)
                    .foregroundStyle(palette.muted)
            }
            Spacer()
        }
        .padding(10)
        .background(palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay { if poof { SparkleBurst().allowsHitTesting(false) } }
        .opacity(poof ? 0.2 : 1)
    }

    private func toggle() async {
        if occurrence.status == .completed {
            try? await model.api.postVoid("tasks/\(occurrence.taskId)/occurrences/\(occurrence.id)/undo")
        } else {
            poof = true
            onClear()
            try? await Task.sleep(nanoseconds: 420_000_000)
            do {
                try await model.api.postVoid("tasks/\(occurrence.taskId)/occurrences/\(occurrence.id)/complete")
                await TaskActivity.stop(taskId: occurrence.taskId)
            } catch {}
        }
        await onChange()
    }
}

struct SparkleBurst: View {
    @Environment(\.palette) private var palette
    private let spots: [(CGFloat, CGFloat)] = [(-28, -24), (22, -30), (36, -8), (-8, -36), (30, 8), (-34, 4), (8, -16), (18, -40)]

    var body: some View {
        ZStack {
            ForEach(Array(spots.enumerated()), id: \.offset) { _, spot in
                Image(systemName: "sparkle")
                    .font(.caption)
                    .foregroundStyle(spot.0 > 0 ? palette.accent : Color(red: 0.89, green: 0.64, blue: 0.13))
                    .offset(x: spot.0, y: spot.1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.leading, 18)
    }
}
