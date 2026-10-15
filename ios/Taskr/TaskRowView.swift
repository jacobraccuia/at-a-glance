import SwiftUI

struct TaskRowView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    let task: TaskItem
    var showAdd: Bool
    var onChange: () async -> Void
    var onOpen: () -> Void

    @State private var poof = false
    @State private var dragX: CGFloat = 0

    private var swipeStage: String {
        if dragX <= -76 { return "done" }
        if dragX >= 168 { return "far" }
        if dragX >= 76 { return "near" }
        return "none"
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
                Text(swipeStage == "far" ? "3 days" : "Tomorrow")
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
                dragX = min(220, max(-220, dx))
            }
            .onEnded { _ in
                let x = dragX
                dragX = 0
                guard task.status != .completed else { return }
                if x <= -76 { Task { await toggle() } }
                else if x >= 168 { Task { await snooze(days: 3) } }
                else if x >= 76 { Task { await snooze(days: 1) } }
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
                if showAdd && task.recurrenceRuleId == nil && !ISO8601.isToday(task.attentionDate) {
                    icon("plus") { Task { await addToday() } }
                }
                icon("pencil") { onOpen() }
                icon("clock") { Task { await snooze(days: 1) } }
                icon("trash") { Task { await drop() } }
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
                if let due = task.hardDeadline, let date = ISO8601.date(due) {
                    pill("Due \(date.formatted(date: .abbreviated, time: .omitted))")
                }
                if let wait = task.waitingOn, !wait.isEmpty { pill("Waiting: \(wait)") }
                if let minutes = task.estimateMinutes { pill("~\(minutes)m") }
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

    private func icon(_ name: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name)
                .font(.caption)
                .frame(width: 28, height: 28)
                .foregroundStyle(name == "trash" ? palette.danger : palette.muted)
        }
    }

    private func toggle() async {
        if task.status == .completed {
            try? await model.api.postVoid("tasks/\(task.id)/undo")
            await onChange()
            return
        }
        poof = true
        try? await Task.sleep(nanoseconds: 520_000_000)
        try? await model.api.postVoid("tasks/\(task.id)/complete")
        await onChange()
    }

    private func snooze(days: Int = 1) async {
        let until = Calendar.current.date(byAdding: .day, value: days, to: Date()) ?? Date()
        struct Body: Encodable { let until: String }
        try? await model.api.postVoid("tasks/\(task.id)/snooze", body: Body(until: ISO8601.string(until)))
        await onChange()
    }

    private func drop() async {
        try? await model.api.postVoid("tasks/\(task.id)/drop")
        await onChange()
    }

    private func addToday() async {
        struct Body: Encodable { let attentionDate: String; let status: String }
        let body = Body(attentionDate: ISO8601.string(Date()), status: "active")
        let _: TaskItem? = try? await model.api.patch("tasks/\(task.id)", body: body)
        await onChange()
    }
}

struct OccurrenceRowView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    let occurrence: TaskOccurrence
    var onChange: () async -> Void
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
                Text("Recurring").font(.caption2).foregroundStyle(palette.muted)
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
            try? await Task.sleep(nanoseconds: 420_000_000)
            try? await model.api.postVoid("tasks/\(occurrence.taskId)/occurrences/\(occurrence.id)/complete")
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
