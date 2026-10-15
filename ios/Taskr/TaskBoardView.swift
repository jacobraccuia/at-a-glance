import SwiftUI

struct TaskBoardView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    var initial: BoardView

    @State private var view: BoardView
    @State private var tasks: [TaskItem] = []
    @State private var occurrences: [TaskOccurrence] = []
    @State private var buckets: [Bucket] = []
    @State private var wins: [EasyWin] = []
    @State private var winMinutes = 25
    @State private var search = ""
    @State private var statusFilter = ""
    @State private var bucketFilter = ""
    @State private var filtersOpen = false
    @State private var draft = ""
    @State private var error: String?
    @State private var loading = true
    @State private var detail: TaskItem?

    init(initial: BoardView) {
        self.initial = initial
        _view = State(initialValue: initial)
    }

    private var pending: [TaskItem] {
        view == .today ? tasks.filter { $0.status == .active } : tasks
    }
    private var completed: [TaskItem] {
        view == .today ? tasks.filter { $0.status == .completed } : []
    }
    private var pendingOccurrences: [TaskOccurrence] {
        occurrences.filter { $0.status == .pending || view != .today }
    }
    private var completedOccurrences: [TaskOccurrence] {
        view == .today ? occurrences.filter { $0.status == .completed } : []
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                chipRow
                if view == .today && !wins.isEmpty {
                    easyWins
                }
                capture
                if filtersOpen { filters }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(palette.danger)
                }
                if loading && tasks.isEmpty {
                    ProgressView()
                }
                ForEach(pending) { task in
                    TaskRowView(task: task, showAdd: view != .today, onChange: { await reload() }, onOpen: { detail = task })
                }
                ForEach(pendingOccurrences) { item in
                    OccurrenceRowView(occurrence: item, onChange: { await reload() })
                }
                if !loading && pending.isEmpty && pendingOccurrences.isEmpty && completed.isEmpty && completedOccurrences.isEmpty {
                    Text("Nothing here.").foregroundStyle(palette.muted)
                }
                if view == .today && (!completed.isEmpty || !completedOccurrences.isEmpty) {
                    DisclosureGroup("\(completed.count + completedOccurrences.count) done") {
                        ForEach(completed) { task in
                            TaskRowView(task: task, showAdd: false, onChange: { await reload() }, onOpen: { detail = task })
                        }
                        ForEach(completedOccurrences) { item in
                            OccurrenceRowView(occurrence: item, onChange: { await reload() })
                        }
                    }
                    .tint(palette.muted)
                    .padding(.top, 8)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .task(id: loadKey) { await reload() }
        .sheet(item: $detail) { task in
            TaskDetailSheet(task: task) { await reload() }
        }
    }

    private var loadKey: String { "\(view.rawValue)|\(search)|\(statusFilter)|\(bucketFilter)|\(model.boardRevision)" }

    private var chipRow: some View {
        HStack {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(BoardView.allCases) { option in
                        Button(option.label) { view = option }
                            .font(.subheadline.weight(view == option ? .semibold : .regular))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(view == option ? palette.accent : palette.surface)
                            .foregroundStyle(view == option ? Color.white : palette.ink)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(palette.border))
                    }
                }
            }
            Button {
                filtersOpen.toggle()
            } label: {
                Image(systemName: "magnifyingglass")
                    .padding(8)
                    .background(filtersOpen ? palette.accentSoft : palette.surface)
                    .clipShape(Circle())
            }
            .accessibilityLabel("Search and filter")
        }
    }

    private var easyWins: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Easy wins").font(.headline)
                Spacer()
                Text("~\(winMinutes) min").font(.caption).foregroundStyle(palette.muted)
            }
            ForEach(wins) { win in
                Button {
                    Task { await open(win.id) }
                } label: {
                    HStack {
                        Text(win.title)
                        Spacer()
                        Text(win.estimateMinutes.map { "~\($0)m" } ?? "~\(win.assumedMinutes)m?")
                            .font(.caption)
                            .foregroundStyle(palette.muted)
                    }
                    .padding(10)
                    .background(palette.accentSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var capture: some View {
        HStack {
            TextField("Add to Today...", text: $draft)
                .submitLabel(.done)
                .onSubmit { Task { await captureNow() } }
            Button {
                Task { await captureNow() }
            } label: {
                Image(systemName: "arrow.right")
                    .frame(width: 36, height: 36)
                    .background(palette.accent)
                    .foregroundStyle(.white)
                    .clipShape(Circle())
            }
            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("Add")
        }
        .padding(8)
        .background(palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(palette.border))
    }

    private var filters: some View {
        VStack(spacing: 8) {
            TextField("Search...", text: $search)
                .textFieldStyle(.roundedBorder)
            if view == .all {
                Picker("Status", selection: $statusFilter) {
                    Text("Open").tag("")
                    Text("Captured").tag("captured")
                    Text("Active").tag("active")
                    Text("Completed").tag("completed")
                    Text("Dropped").tag("dropped")
                }
            }
            Picker("Bucket", selection: $bucketFilter) {
                Text("All buckets").tag("")
                ForEach(buckets) { bucket in
                    Text(bucket.name).tag(bucket.id)
                }
            }
        }
    }

    private func reload() async {
        loading = true
        defer { loading = false }
        var query = ["view": view.rawValue]
        if !search.isEmpty { query["search"] = search }
        if view == .all && !statusFilter.isEmpty { query["status"] = statusFilter }
        if !bucketFilter.isEmpty { query["bucketId"] = bucketFilter }
        let qs = query.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }.joined(separator: "&")
        do {
            if view == .today || view == .upcoming {
                let payload: TodayPayload = try await model.api.get("tasks?\(qs)")
                tasks = payload.tasks
                occurrences = payload.occurrences
            } else {
                tasks = try await model.api.get("tasks?\(qs)")
                occurrences = []
            }
            buckets = try await model.api.get("buckets")
            if view == .today {
                let easy: EasyWinsPayload = try await model.api.get("assistant/easy-wins?minutes=25")
                wins = easy.wins
                winMinutes = easy.minutes
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func captureNow() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        struct Body: Encodable { let text: String; let addToToday: Bool }
        do {
            let _: [TaskItem] = try await model.api.post("tasks/quick-capture", body: Body(text: text, addToToday: true))
            await reload()
        } catch {
            self.error = error.localizedDescription
            draft = text
        }
    }

    private func open(_ id: String) async {
        let task: TaskItem? = try? await model.api.get("tasks/\(id)")
        detail = task
    }
}

struct TaskDetailSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State var task: TaskItem
    var onChange: () async -> Void
    @State private var buckets: [Bucket] = []
    @State private var title: String = ""
    @State private var notes: String = ""
    @State private var estimate: String = ""
    @State private var waiting: String = ""
    @State private var deadlineOn = false
    @State private var deadline = Date()
    @State private var importance: Importance = .medium
    @State private var bucketId: String = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title)
                TextField("Notes", text: $notes, axis: .vertical)
                TextField("Minutes", text: $estimate)
                    .keyboardType(.numberPad)
                TextField("Waiting on", text: $waiting)
                Toggle("Deadline", isOn: $deadlineOn)
                if deadlineOn {
                    DatePicker("Due", selection: $deadline)
                }
                Picker("Importance", selection: $importance) {
                    ForEach(Importance.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                }
                Picker("Bucket", selection: $bucketId) {
                    Text("None").tag("")
                    ForEach(buckets) { Text($0.name).tag($0.id) }
                }
            }
            .navigationTitle("Details")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } } }
            }
            .task {
                title = task.title
                notes = task.notes ?? ""
                estimate = task.estimateMinutes.map(String.init) ?? ""
                waiting = task.waitingOn ?? ""
                if let raw = task.hardDeadline, let parsed = ISO8601.date(raw) {
                    deadlineOn = true
                    deadline = parsed
                }
                importance = task.importance
                bucketId = task.bucketId ?? ""
                buckets = (try? await model.api.get("buckets")) ?? []
            }
        }
    }

    private func save() async {
        struct Body: Encodable {
            let title: String
            let notes: String
            let estimateMinutes: Int?
            let importance: String
            let bucketId: String?
            let waitingOn: String?
            let hardDeadline: String?
            let deadlineSource: String?
        }
        let body = Body(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            notes: notes,
            estimateMinutes: Int(estimate),
            importance: importance.rawValue,
            bucketId: bucketId.isEmpty ? nil : bucketId,
            waitingOn: waiting.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : waiting.trimmingCharacters(in: .whitespacesAndNewlines),
            hardDeadline: deadlineOn ? ISO8601.string(deadline) : nil,
            deadlineSource: deadlineOn ? "explicit" : nil
        )
        let _: TaskItem? = try? await model.api.patch("tasks/\(task.id)", body: body)
        await onChange()
        dismiss()
    }
}
