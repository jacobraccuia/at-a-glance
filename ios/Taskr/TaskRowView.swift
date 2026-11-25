import SwiftUI

struct TaskRowView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    let task: TaskItem
    var onChange: () async -> Void
    var onClear: () -> Void = {}
    var onOpen: () -> Void
    /// True once the drag is far enough to move or archive, so a bucket swipe can ignore it.
    var onClaimSwipe: (Bool) -> Void = { _ in }

    @State private var poof = false
    @State private var stamp: String?
    @State private var dragX: CGFloat = 0
    @State private var letScroll = false

    /// Far enough that a diagonal scroll cannot archive a task.
    private let commit: CGFloat = 200

    private var rightLabel: String {
        dragX >= 300 ? "Upcoming" : "Tomorrow"
    }

    private var swipeColor: Color {
        if dragX < 0 { return Color(red: 0.38, green: 0.4, blue: 0.5) }
        return dragX >= 300 ? Color(red: 0.55, green: 0.32, blue: 0.08) : Color(red: 0.85, green: 0.52, blue: 0.1)
    }

    var body: some View {
        ZStack {
            swipeBackdrop
            rowBody
                .offset(x: dragX)
                .simultaneousGesture(rowSwipe)
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
                Image(systemName: "archivebox")
                Text("Archive").font(.caption.weight(.semibold))
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(swipeColor)
    }

    private var rowSwipe: some Gesture {
        DragGesture(minimumDistance: 28, coordinateSpace: .local)
            .onChanged { value in
                guard task.status != .completed, stamp == nil else { return }
                let dx = value.translation.width
                let dy = value.translation.height
                if abs(dx) < 8 && abs(dy) < 8 { letScroll = false }
                if letScroll { return }
                if abs(dy) > 22 && abs(dy) >= abs(dx) {
                    letScroll = true
                    dragX = 0
                    onClaimSwipe(false)
                    return
                }
                guard abs(dx) > 48, abs(dx) > abs(dy) * 2 else { return }
                dragX = min(320, max(-320, dx))
                onClaimSwipe(abs(dragX) >= commit)
            }
            .onEnded { value in
                let x = dragX
                let dy = value.translation.height
                let scrolling = letScroll
                dragX = 0
                letScroll = false
                let claimed = !scrolling && abs(x) >= commit && abs(x) > abs(dy) * 2
                onClaimSwipe(claimed)
                DispatchQueue.main.async { onClaimSwipe(false) }
                guard task.status != .completed, claimed else { return }
                if x <= -commit { Task { await archive() } }
                else if x >= 300 { Task { await settle("Upcoming") { await move("nextWeek") } } }
                else { Task { await settle("Tomorrow") { await move("tomorrow") } } }
            }
    }

    private var rowBody: some View {
        HStack(alignment: .center, spacing: 10) {
            Button {
                Task { await toggle() }
            } label: {
                Image(systemName: task.status == .completed || poof ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(task.status == .completed || poof ? palette.accent : palette.muted)
                    .frame(width: 32, height: 32)
                    .scaleEffect(poof ? 1.15 : 1)
            }
            .accessibilityLabel(task.status == .completed ? "Mark not done" : "Mark done")

            VStack(alignment: .leading, spacing: 4) {
                Text(task.title)
                    .lineLimit(2)
                    .truncationMode(.tail)
                    .strikethrough(task.status == .completed || stamp != nil)
                    .foregroundStyle(task.status == .completed || stamp != nil ? palette.muted : palette.ink)
                if let stamp {
                    Text(stamp)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(palette.muted)
                }
                if hasMeta { meta }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture { onOpen() }
        }
        .padding(10)
        .background(palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(palette.border))
        .overlay { if poof { SparkleBurst().allowsHitTesting(false) } }
        .opacity(stamp == nil ? 1 : 0.55)
        .offset(y: poof ? -10 : 0)
        .animation(.easeOut(duration: 0.55), value: poof)
    }

    private var hasMeta: Bool {
        if task.importance == .high || task.effort != nil || task.hardDeadline != nil || task.attentionDate != nil || task.estimateMinutes != nil {
            return true
        }
        if let wait = task.waitingOn, !wait.isEmpty { return true }
        if let notes = task.notes, !notes.isEmpty { return true }
        if task.status == .completed, ISO8601.doneIn(from: task.createdAt, to: task.completedAt) != nil { return true }
        if let attention = task.attentionDate, ISO8601.date(attention) != nil { return true }
        return false
    }

    /// The day it was placed on. A hard deadline with no day says Due.
    private var whenLabel: String? {
        let scheduled = task.attentionDate.flatMap(ISO8601.date)
        let deadline = task.hardDeadline.flatMap(ISO8601.date)
        guard let date = scheduled ?? deadline else { return nil }
        let time = DayStamp.isDateOnly(date, accountTimeZone: model.user?.timezone) ? nil : date
        let label = DayStamp.shortDay(date, time: time)
        return scheduled == nil ? "Due \(label)" : label
    }

    private var meta: some View {
        HStack(spacing: 6) {
            if task.importance == .high { pill("Important") }
                if let effort = task.effort { pill("\(effort.label) effort") }
                if let label = whenLabel {
                    pill(label)
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

    private func settle(_ label: String, _ work: () async -> Void) async {
        guard stamp == nil else { return }
        stamp = label
        if label == "Done" { poof = true }
        try? await Task.sleep(nanoseconds: 1_100_000_000)
        await work()
        onClear()
        await onChange()
    }

    private func toggle() async {
        if task.status == .completed {
            try? await model.api.postVoid("tasks/\(task.id)/undo")
            await onChange()
            return
        }
        await settle("Done") {
            try? await model.api.postVoid("tasks/\(task.id)/complete")
            await TaskActivity.stop(taskId: task.id)
        }
    }

    private func archive() async {
        await settle("Archived") {
            try? await model.api.postVoid("tasks/\(task.id)/archive")
            await TaskActivity.stop(taskId: task.id)
        }
    }

    private func move(_ horizon: String) async {
        struct Body: Encodable { let horizon: String }
        try? await model.api.postVoid("tasks/\(task.id)/horizon", body: Body(horizon: horizon))
        await TaskActivity.stop(taskId: task.id)
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
                    .font(.title2)
                    .foregroundStyle(occurrence.status == .completed || poof ? palette.accent : palette.muted)
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
