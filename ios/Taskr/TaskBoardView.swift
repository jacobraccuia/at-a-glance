import SwiftUI

struct TaskBoardView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @Binding var view: BoardView
    @State private var tasks: [TaskItem] = []
    @State private var occurrences: [TaskOccurrence] = []
    @State private var buckets: [Bucket] = []
    @State private var wins: [EasyWin] = []
    @State private var winTasks: [TaskItem] = []
    @State private var winsReady = false
    @State private var winsTicket = 0
    @State private var search = ""
    @State private var statusFilter = ""
    @State private var filtersOpen = false
    @State private var draft = ""
    @State private var captureNote: String?
    @State private var error: String?
    @State private var loading = true
    @State private var detail: TaskItem?

    private var pending: [TaskItem] {
        let open = model.hideFinished ? tasks.filter { $0.status != .completed } : tasks
        return view == .today ? open.filter { $0.status == .active } : open
    }
    private var completed: [TaskItem] {
        view == .today && !model.hideFinished ? tasks.filter { $0.status == .completed } : []
    }
    private var pendingOccurrences: [TaskOccurrence] {
        occurrences.filter { item in
            if model.hideFinished && item.status == .completed { return false }
            return item.status == .pending || view != .today
        }
    }
    private var completedOccurrences: [TaskOccurrence] {
        view == .today && !model.hideFinished ? occurrences.filter { $0.status == .completed } : []
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                titleRow
                chipRow
                bucketPager
                if view == .today {
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
                    TaskRowView(task: task, showAdd: view != .today, onChange: { await reload() }, onClear: { clearWin(task.id) }, onOpen: { detail = task })
                }
                ForEach(pendingOccurrences) { item in
                    OccurrenceRowView(occurrence: item, onChange: { await reload() }, onClear: { clearWin(item.taskId) })
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
            .padding(.bottom, 8)
        }
        .gesture(bucketDrag)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: 8) {
                switchChip(model.hideWork ? "Work hidden" : "Hide work", on: model.hideWork) {
                    model.hideWork.toggle()
                    syncTint()
                }
                switchChip(model.hideFinished ? "Finished hidden" : "Hide finished", on: model.hideFinished) {
                    model.hideFinished.toggle()
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(palette.bg.opacity(0.94))
        }
        .task(id: loadKey) { await reload() }
        .task(id: winsKey) { await reloadWins() }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: model.pendingTaskId) { await openPending() }
        .onChange(of: model.bucketSpot) { _, _ in syncTint() }
        .onReceive(NotificationCenter.default.publisher(for: .taskrTasksChanged)) { _ in
            Task { await reload() }
        }
        .sheet(item: $detail) { task in
            TaskDetailSheet(task: task) { await reload() }
        }
    }

    private var openBuckets: [Bucket] {
        buckets
            .filter { $0.archivedAt == nil && !(model.hideWork && isWorkName($0.name)) }
            .sorted { $0.sortOrder < $1.sortOrder }
    }

    private func isWorkName(_ name: String) -> Bool {
        name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "work"
    }

    private var pages: [(id: String, name: String, color: String?)] {
        [("", "All buckets", nil)] + openBuckets.map { ($0.id, $0.name, $0.color) }
    }

    private var pageIndex: Int {
        max(0, pages.firstIndex { $0.id == model.bucketSpot } ?? 0)
    }

    private var loadKey: String {
        "\(view.rawValue)|\(search)|\(statusFilter)|\(model.bucketSpot)|\(model.boardRevision)|\(model.hideWork)"
    }

    private var winsKey: String {
        "\(view.rawValue)|\(model.winMinutes)|\(model.bucketSpot)|\(model.hideWork)"
    }

    private var bucketDrag: some Gesture {
        DragGesture(minimumDistance: 28)
            .onEnded { value in
                let dx = value.translation.width
                let dy = value.translation.height
                guard abs(dx) > 64, abs(dx) > abs(dy) * 1.4 else { return }
                shiftSpot(dx < 0 ? 1 : -1)
            }
    }

    private func shiftSpot(_ dir: Int) {
        guard pages.count > 1 else { return }
        let next = min(pages.count - 1, max(0, pageIndex + dir))
        guard next != pageIndex else { return }
        model.bucketSpot = pages[next].id
        syncTint()
    }

    private func syncTint() {
        let open = openBuckets
        if !model.bucketSpot.isEmpty && !open.contains(where: { $0.id == model.bucketSpot }) {
            model.bucketSpot = ""
        }
        model.bucketTintHex = open.first { $0.id == model.bucketSpot }?.color
    }

    private var bucketPager: some View {
        VStack(spacing: 6) {
            HStack {
                Button { shiftSpot(-1) } label: {
                    Image(systemName: "chevron.left")
                        .frame(width: 36, height: 36)
                }
                .disabled(pageIndex <= 0)
                .accessibilityLabel("Previous bucket")
                Spacer()
                Text(pages[pageIndex].name).font(.headline)
                Spacer()
                Button { shiftSpot(1) } label: {
                    Image(systemName: "chevron.right")
                        .frame(width: 36, height: 36)
                }
                .disabled(pageIndex >= pages.count - 1)
                .accessibilityLabel("Next bucket")
            }
            if pages.count > 1 {
                HStack(spacing: 6) {
                    ForEach(Array(pages.enumerated()), id: \.offset) { index, page in
                        Button {
                            model.bucketSpot = page.id
                            syncTint()
                        } label: {
                            Capsule()
                                .fill(index == pageIndex ? palette.accent : palette.border)
                                .frame(width: index == pageIndex ? 16 : 7, height: 7)
                        }
                        .accessibilityLabel(page.name)
                    }
                }
            }
        }
    }

    private var titleRow: some View {
        HStack(spacing: 8) {
            Text(Branding.appName)
                .font(.title3.weight(.bold))
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .layoutPriority(1)
            Spacer(minLength: 12)
            Button {
                filtersOpen.toggle()
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.title2)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Search and filter")
            NavigationLink {
                AccountView()
            } label: {
                Image(systemName: "person.circle")
                    .font(.title2)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Account")
        }
    }

    private func switchChip(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(on ? palette.accent : palette.surface)
                .foregroundStyle(on ? Color.white : palette.ink)
                .clipShape(Capsule())
        }
    }

    private var chipRow: some View {
        HStack(spacing: 6) {
            ForEach(BoardView.allCases) { option in
                Button(option.label) { view = option }
                    .font(.caption.weight(view == option ? .semibold : .regular))
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity)
                    .background(view == option ? palette.accent : palette.surface)
                    .foregroundStyle(view == option ? Color.white : palette.ink)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(palette.border))
            }
        }
    }

    private var easyWins: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Easy wins").font(.headline)
                Spacer()
                ForEach([15, 30, 45], id: \.self) { minutes in
                    Button("\(minutes)m") { model.winMinutes = minutes }
                        .font(.caption.weight(model.winMinutes == minutes ? .semibold : .regular))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(model.winMinutes == minutes ? palette.accent : palette.surface)
                        .foregroundStyle(model.winMinutes == minutes ? Color.white : palette.ink)
                        .clipShape(Capsule())
                }
            }
            if winsReady && wins.isEmpty {
                Text("Nothing that fits \(model.winMinutes) minutes.").font(.caption).foregroundStyle(palette.muted)
            }
            ForEach(winTasks) { task in
                TaskRowView(
                    task: task,
                    showAdd: true,
                    onChange: { await reload() },
                    onClear: { clearWin(task.id) },
                    onOpen: { detail = task }
                )
            }
        }
    }

    private var capture: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                TextField("Add a task...", text: $draft)
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
            if let captureNote {
                Text(captureNote).font(.caption).foregroundStyle(palette.muted)
            }
        }
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
            Picker("Bucket", selection: $model.bucketSpot) {
                Text("All buckets").tag("")
                ForEach(buckets) { bucket in
                    Text(bucket.name).tag(bucket.id)
                }
            }
        }
    }

    private func clearWin(_ id: String) {
        wins.removeAll { $0.id == id }
        winTasks.removeAll { $0.id == id }
    }

    private func reloadWins() async -> [EasyWin] {
        guard view == .today else { return wins }
        winsTicket += 1
        let ticket = winsTicket
        var easyQuery = ["minutes": "\(model.winMinutes)"]
        if !model.bucketSpot.isEmpty { easyQuery["bucketId"] = model.bucketSpot }
        else if model.hideWork { easyQuery["excludeBucketName"] = "Work" }
        let easyQS = easyQuery.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }.joined(separator: "&")
        do {
            let easy: EasyWinsPayload = try await model.api.get("assistant/easy-wins?\(easyQS)")
            guard ticket == winsTicket else { return wins }
            wins = easy.wins
            var rows = easy.tasks ?? []
            if rows.isEmpty {
                for win in easy.wins {
                    if let task: TaskItem = try? await model.api.get("tasks/\(win.id)") {
                        rows.append(task)
                    }
                }
            }
            guard ticket == winsTicket else { return wins }
            winTasks = rows
            winsReady = true
            return easy.wins
        } catch {
            if ticket == winsTicket { winsReady = true }
            return wins
        }
    }

    private func reload() async {
        loading = true
        defer { loading = false }
        var query = ["view": view.rawValue]
        if !search.isEmpty { query["search"] = search }
        if view == .all && !statusFilter.isEmpty { query["status"] = statusFilter }
        if !model.bucketSpot.isEmpty { query["bucketId"] = model.bucketSpot }
        else if model.hideWork { query["excludeBucketName"] = "Work" }
        let qs = query.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }.joined(separator: "&")
        do {
            if view.usesHorizonPayload {
                let payload: TodayPayload = try await model.api.get("tasks?\(qs)")
                tasks = payload.tasks
                occurrences = payload.occurrences
            } else {
                tasks = try await model.api.get("tasks?\(qs)")
                occurrences = []
            }
            buckets = try await model.api.get("buckets")
            syncTint()
            if view == .today {
                let fresh = await reloadWins()
                TodayGlance.publish(tasks: tasks, occurrences: occurrences, wins: fresh, accentHex: model.accentHex)
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
        struct Body: Encodable { let text: String }
        struct Captured: Decodable { let horizon: String? }
        do {
            let created: [Captured] = try await model.api.post("tasks/quick-capture", body: Body(text: text))
            captureNote = savedNote(created.map { $0.horizon ?? "later" })
            await reload()
        } catch {
            self.error = error.localizedDescription
            draft = text
        }
    }

    private func openPending() async {
        guard let id = model.pendingTaskId else { return }
        await open(id)
        if model.pendingTaskId == id { model.pendingTaskId = nil }
    }

    private func savedNote(_ horizons: [String]) -> String {
        let labels = Dictionary(uniqueKeysWithValues: [
            ("today", "Today"), ("tomorrow", "Tomorrow"), ("nextWeek", "Next week"), ("later", "Later"),
        ])
        let places = Array(Set(horizons.map { labels[$0] ?? "Later" }))
        if horizons.count == 1 { return "Saved to \(places[0])." }
        if places.count == 1 { return "Saved \(horizons.count) to \(places[0])." }
        return "Saved \(horizons.count). Each one landed in its own time."
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
    @State private var effort = ""
    @State private var bucketId: String = ""
    @State private var liveOn = false
    @State private var liveNote: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button(liveOn ? "Stop" : "Start") {
                        Task { await toggleLive() }
                    }
                    Text("Lock Screen while you do this one. It leaves when you finish or stop. It does not stay up all day.")
                        .font(.footnote)
                        .foregroundStyle(palette.muted)
                    if let liveNote {
                        Text(liveNote)
                            .font(.footnote)
                            .foregroundStyle(palette.danger)
                    }
                }
                if task.status == .completed, let span = ISO8601.doneIn(from: task.createdAt, to: task.completedAt) {
                    Text(span)
                        .font(.footnote)
                        .foregroundStyle(palette.muted)
                }
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
                Picker("Effort", selection: $effort) {
                    Text("Not set").tag("")
                    Text("Low").tag("low")
                    Text("Medium").tag("medium")
                    Text("High").tag("high")
                }
                Text("Low can be an easy win. Medium only at 45 minutes. High never is. Not set lets the time guess decide.")
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                Picker("Bucket", selection: $bucketId) {
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
                effort = task.effort?.rawValue ?? ""
                bucketId = task.bucketId ?? ""
                buckets = (try? await model.api.get("buckets")) ?? []
                if bucketId.isEmpty, let home = buckets.first(where: { $0.isDefault }) ?? buckets.first {
                    bucketId = home.id
                }
                liveOn = TaskActivity.isRunning(task.id)
            }
        }
    }

    private func save() async {
        struct Body: Encodable {
            let title: String
            let notes: String
            let estimateMinutes: Int?
            let importance: String
            let effort: String?
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
            effort: effort.isEmpty ? nil : effort,
            bucketId: bucketId.isEmpty ? nil : bucketId,
            waitingOn: waiting.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : waiting.trimmingCharacters(in: .whitespacesAndNewlines),
            hardDeadline: deadlineOn ? ISO8601.string(deadline) : nil,
            deadlineSource: deadlineOn ? "explicit" : nil
        )
        let _: TaskItem? = try? await model.api.patch("tasks/\(task.id)", body: body)
        await onChange()
        dismiss()
    }

    private func toggleLive() async {
        if liveOn {
            await TaskActivity.stop(taskId: task.id)
            liveOn = false
            liveNote = nil
            return
        }
        let minutes = Int(estimate) ?? task.estimateMinutes
        let ok = await TaskActivity.begin(id: task.id, title: title, minutes: minutes, accentHex: model.accentHex)
        liveOn = ok
        liveNote = ok ? nil : "Live Activities are off in Settings."
    }
}
