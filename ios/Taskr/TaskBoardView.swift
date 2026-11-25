import SwiftUI

struct TaskBoardView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @Binding var view: BoardView
    @State private var tasks: [TaskItem] = []
    @State private var occurrences: [TaskOccurrence] = []
    @State private var tomorrowTasks: [TaskItem] = []
    @State private var tomorrowOccurrences: [TaskOccurrence] = []
    @State private var buckets: [Bucket] = []
    @State private var search = ""
    @State private var statusFilter = ""
    @State private var filtersOpen = false
    @State private var searchOpen = false
    @State private var error: String?
    @State private var loading = true
    @State private var detail: TaskItem?

    /// Last item in the bucket menu. Not a real bucket id.
    private static let archiveSpot = "__archive"
    private var showingArchive: Bool { model.bucketSpot == Self.archiveSpot }

    private var pending: [TaskItem] {
        let hideDone = statusFilter != "completed" && (model.hideFinished || view == .all)
        let open = hideDone ? tasks.filter { $0.status != .completed } : tasks
        let listed = view == .today ? open.filter { $0.status == .active } : open
        return listed.filter { inSpot($0.bucketId) }
    }
    private var completed: [TaskItem] {
        view == .today && !model.hideFinished ? tasks.filter { $0.status == .completed && inSpot($0.bucketId) } : []
    }
    private var pendingOccurrences: [TaskOccurrence] {
        occurrences.filter { item in
            guard inSpot(item.task?.bucketId) else { return false }
            if model.hideFinished && item.status == .completed { return false }
            return item.status == .pending || view != .today
        }
    }
    private var tomorrowPending: [TaskItem] {
        tomorrowTasks.filter { $0.status == .active && inSpot($0.bucketId) }
    }
    private var tomorrowPendingOccurrences: [TaskOccurrence] {
        tomorrowOccurrences.filter { $0.status == .pending && inSpot($0.task?.bucketId) }
    }
    /// Everything, stacked Today → Tomorrow → Upcoming → Later. Tomorrow stays even when empty.
    private struct HorizonStack: Identifiable {
        let horizon: BoardView
        let tasks: [TaskItem]
        var id: String { horizon.rawValue }
    }

    private var horizonStacks: [HorizonStack] {
        let order: [BoardView] = [.today, .tomorrow, .nextWeek, .later]
        return order.compactMap { horizon in
            let rows = pending.filter { place(of: $0) == horizon }
            if rows.isEmpty && horizon != .tomorrow { return nil }
            return HorizonStack(horizon: horizon, tasks: rows)
        }
    }

    /// Same windows as the server: attention date, else deadline. No date, a past date, or past Upcoming is Later.
    private func place(of task: TaskItem) -> BoardView {
        let raw = task.attentionDate ?? task.hardDeadline
        guard let raw, let instant = ISO8601.date(raw) else { return .later }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: model.user?.timezone ?? "") ?? .current
        let day = cal.startOfDay(for: instant)
        let today = cal.startOfDay(for: Date())
        if day == today { return .today }
        if let tomorrow = cal.date(byAdding: .day, value: 1, to: today), day == tomorrow { return .tomorrow }
        guard let upcomingStart = cal.date(byAdding: .day, value: 2, to: today) else { return .later }
        let weekday = cal.component(.weekday, from: today)
        let thisWeekStart = cal.date(byAdding: .day, value: -(weekday - 1), to: today) ?? today
        let upcomingEnd = cal.date(byAdding: .day, value: 13, to: thisWeekStart) ?? upcomingStart
        let start = cal.startOfDay(for: upcomingStart)
        let end = cal.startOfDay(for: upcomingEnd)
        if day >= start && day <= max(start, end) { return .nextWeek }
        return .later
    }

    private var completedOccurrences: [TaskOccurrence] {
        view == .today && !model.hideFinished ? occurrences.filter { $0.status == .completed && inSpot($0.task?.bucketId) } : []
    }

    /// Bucket pages are a local filter. The list was already loaded.
    private func inSpot(_ bucketId: String?) -> Bool {
        if model.hideWork, let bucketId, let bucket = buckets.first(where: { $0.id == bucketId }), isWorkName(bucket.name) {
            return false
        }
        if model.bucketSpot.isEmpty { return true }
        return bucketId == model.bucketSpot
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                titleRow
                if showingArchive {
                    ArchiveList()
                } else {
                    if let error {
                        Text(error).font(.footnote).foregroundStyle(palette.danger)
                    }
                    if loading && tasks.isEmpty {
                        ProgressView()
                    }
                    if view == .all {
                        if !loading && horizonStacks.isEmpty {
                            Text("Nothing here.").foregroundStyle(palette.muted)
                        }
                        ForEach(Array(horizonStacks.enumerated()), id: \.element.id) { index, stack in
                            Text(stack.horizon.label)
                                .font(.headline)
                                .padding(.top, index == 0 ? 4 : 16)
                            if stack.tasks.isEmpty {
                                Text(stack.horizon == .tomorrow ? "Nothing for tomorrow." : "Nothing here.")
                                    .foregroundStyle(palette.muted)
                            }
                            ForEach(stack.tasks) { task in
                                TaskRowView(task: task, onChange: { await reload() }, onOpen: { detail = task })
                            }
                        }
                    } else {
                    ForEach(pending) { task in
                        TaskRowView(task: task, onChange: { await reload() }, onOpen: { detail = task })
                    }
                    ForEach(pendingOccurrences) { item in
                        OccurrenceRowView(occurrence: item, onChange: { await reload() })
                    }
                    if !loading && pending.isEmpty && pendingOccurrences.isEmpty && completed.isEmpty && completedOccurrences.isEmpty {
                        Text(view == .today ? "Nothing for today." : "Nothing here.").foregroundStyle(palette.muted)
                    }
                    if view == .today && (!tomorrowPending.isEmpty || !tomorrowPendingOccurrences.isEmpty) {
                        Text("Tomorrow")
                            .font(.headline)
                            .padding(.top, 16)
                        ForEach(tomorrowPending) { task in
                            TaskRowView(task: task, onChange: { await reload() }, onOpen: { detail = task })
                        }
                        ForEach(tomorrowPendingOccurrences) { item in
                            OccurrenceRowView(occurrence: item, onChange: { await reload() })
                        }
                    }
                    if view == .today && (!completed.isEmpty || !completedOccurrences.isEmpty) {
                        DisclosureGroup("\(completed.count + completedOccurrences.count) done") {
                            ForEach(completed) { task in
                                TaskRowView(task: task, onChange: { await reload() }, onOpen: { detail = task })
                            }
                            ForEach(completedOccurrences) { item in
                                OccurrenceRowView(occurrence: item, onChange: { await reload() })
                            }
                        }
                        .tint(palette.muted)
                        .padding(.top, 8)
                    }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 200)
        }
        .task(id: loadKey) { await reload() }
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

    private var loadKey: String {
        "\(view.rawValue)|\(search)|\(statusFilter)|\(model.boardRevision)"
    }

    private var filtersOn: Bool {
        model.hideWork || model.hideFinished || !statusFilter.isEmpty
    }

    private var bucketLabel: String {
        if showingArchive { return "Archive" }
        if model.bucketSpot.isEmpty { return "All buckets" }
        return openBuckets.first { $0.id == model.bucketSpot }?.name ?? "All buckets"
    }

    private func syncTint() {
        if showingArchive {
            model.bucketTintHex = nil
            return
        }
        let open = openBuckets
        if !model.bucketSpot.isEmpty && !open.contains(where: { $0.id == model.bucketSpot }) {
            model.bucketSpot = ""
        }
        model.bucketTintHex = open.first { $0.id == model.bucketSpot }?.color
    }

    private var titleRow: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 10) {
                Text(Branding.appName)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(palette.ink)
                Spacer(minLength: 8)
                headerCircle("magnifyingglass", "Search", on: searchOpen || !search.isEmpty) {
                    searchOpen.toggle()
                }
                headerCircle("slider.horizontal.3", "Filters", on: filtersOpen || filtersOn) {
                    filtersOpen.toggle()
                }
                .popover(isPresented: $filtersOpen, attachmentAnchor: .rect(.bounds), arrowEdge: .top) {
                    filters
                        .padding(12)
                        .frame(minWidth: 260)
                        .presentationCompactAdaptation(.popover)
                }
                NavigationLink {
                    AccountView()
                } label: {
                    Image(systemName: "person.circle")
                        .font(.title3)
                        .frame(width: 48, height: 48)
                        .foregroundStyle(palette.ink)
                        .background(palette.surface)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(palette.border))
                }
                .accessibilityLabel("Account")
            }
            HStack {
                Menu {
                    ForEach(BoardView.allCases) { option in
                        Button(option.label) { view = option }
                    }
                } label: {
                    pickerLabel(view.label)
                }
                .accessibilityLabel("Timeframe, \(view.label)")
                Spacer(minLength: 12)
                Menu {
                    Button("All buckets") { model.bucketSpot = "" }
                    ForEach(openBuckets) { bucket in
                        Button(bucket.name) { model.bucketSpot = bucket.id }
                    }
                    Button("Archive") { model.bucketSpot = Self.archiveSpot }
                } label: {
                    pickerLabel(bucketLabel)
                }
                .accessibilityLabel("Bucket, \(bucketLabel)")
            }
            if searchOpen || !search.isEmpty {
                TextField("Search...", text: $search)
                    .textFieldStyle(.roundedBorder)
            }
        }
    }

    private func pickerLabel(_ title: String) -> some View {
        HStack(spacing: 4) {
            Text(title)
                .font(.title3.weight(.semibold))
                .lineLimit(1)
            Image(systemName: "chevron.down")
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(palette.ink)
        .padding(.vertical, 10)
    }

    private func headerCircle(_ symbol: String, _ label: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .frame(width: 48, height: 48)
                .foregroundStyle(on ? palette.accent : palette.ink)
                .background(palette.surface)
                .clipShape(Circle())
                .overlay(Circle().stroke(on ? palette.accent : palette.border))
        }
        .accessibilityLabel(label)
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

    private var filters: some View {
        VStack(spacing: 8) {
            if view == .all {
                Picker("Status", selection: $statusFilter) {
                    Text("Open").tag("")
                    Text("Captured").tag("captured")
                    Text("Active").tag("active")
                    Text("Completed").tag("completed")
                    Text("Dropped").tag("dropped")
                }
            }
            HStack(spacing: 8) {
                switchChip(model.hideWork ? "Work hidden" : "Hide work", on: model.hideWork) {
                    model.hideWork.toggle()
                    syncTint()
                }
                switchChip(model.hideFinished ? "Finished hidden" : "Hide finished", on: model.hideFinished) {
                    model.hideFinished.toggle()
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
                if let soon: TodayPayload = try? await model.api.get("tasks?view=tomorrow") {
                    tomorrowTasks = soon.tasks
                    tomorrowOccurrences = soon.occurrences
                }
                TodayGlance.publish(tasks: tasks, occurrences: occurrences, accentHex: model.accentHex)
            } else {
                tomorrowTasks = []
                tomorrowOccurrences = []
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func openPending() async {
        guard let id = model.pendingTaskId else { return }
        await open(id)
        if model.pendingTaskId == id { model.pendingTaskId = nil }
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
    @State private var whenOn = false
    @State private var when = Date()
    @State private var timeOn = false
    @State private var whenTime = Date()
    @State private var deadlineOn = false
    @State private var deadline = Date()
    @State private var deadlineTimeOn = false
    @State private var deadlineTime = Date()
    @State private var importance: Importance = .medium
    @State private var effort = ""
    @State private var bucketId: String = ""
    @State private var liveOn = false
    @State private var liveNote: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    card {
                        TextField("Title", text: $title)
                            .font(.title2.weight(.semibold))
                        TextField("Notes", text: $notes, axis: .vertical)
                            .font(.subheadline)
                            .foregroundStyle(notes.isEmpty ? palette.muted : palette.ink)
                            .lineLimit(2...5)
                    }
                    card {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("When")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(palette.muted)
                                Text(whenOn ? DayStamp.phrase(when, time: timeOn ? whenTime : nil) : "No day")
                                    .font(.title3.weight(.semibold))
                            }
                            Spacer(minLength: 12)
                            Toggle("Day", isOn: $whenOn)
                                .labelsHidden()
                        }
                        if whenOn {
                            DatePicker("Day", selection: $when, displayedComponents: .date)
                                .labelsHidden()
                            detailRow("Time") {
                                if timeOn {
                                    DatePicker("Time", selection: $whenTime, displayedComponents: .hourAndMinute)
                                        .labelsHidden()
                                } else {
                                    Text("None").foregroundStyle(palette.muted)
                                }
                                Toggle("Time", isOn: $timeOn)
                                    .labelsHidden()
                            }
                        }
                    }
                    card {
                        detailRow("Bucket") {
                            Menu(bucketName) {
                                ForEach(buckets) { bucket in
                                    Button(bucket.name) { bucketId = bucket.id }
                                }
                            }
                            .fontWeight(.semibold)
                        }
                        divider
                        detailRow("Importance") {
                            Menu(importance.rawValue.capitalized) {
                                ForEach(Importance.allCases, id: \.self) { level in
                                    Button(level.rawValue.capitalized) { importance = level }
                                }
                            }
                            .fontWeight(.semibold)
                        }
                        divider
                        detailRow("Effort") {
                            Menu(effort.isEmpty ? "Not set" : effort.capitalized) {
                                Button("Not set") { effort = "" }
                                Button("Low") { effort = "low" }
                                Button("Medium") { effort = "medium" }
                                Button("High") { effort = "high" }
                            }
                            .fontWeight(.semibold)
                            .foregroundStyle(effort.isEmpty ? palette.muted : palette.ink)
                        }
                        divider
                        detailRow("Estimate") {
                            TextField("min", text: $estimate)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 72)
                        }
                        divider
                        detailRow("Waiting on") {
                            TextField("Who or what", text: $waiting)
                                .multilineTextAlignment(.trailing)
                        }
                        divider
                        detailRow("Deadline") {
                            Toggle("Deadline", isOn: $deadlineOn)
                                .labelsHidden()
                        }
                        if deadlineOn {
                            DatePicker("Deadline day", selection: $deadline, displayedComponents: .date)
                                .labelsHidden()
                            detailRow("Deadline time") {
                                if deadlineTimeOn {
                                    DatePicker("Deadline time", selection: $deadlineTime, displayedComponents: .hourAndMinute)
                                        .labelsHidden()
                                } else {
                                    Text("None").foregroundStyle(palette.muted)
                                }
                                Toggle("Deadline time", isOn: $deadlineTimeOn)
                                    .labelsHidden()
                            }
                        }
                    }
                    card {
                        Button {
                            Task { await toggleLive() }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: liveOn ? "stop.circle.fill" : "play.circle.fill")
                                Text(liveOn ? "Stop live" : "Start live")
                                Spacer()
                            }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(palette.accent)
                        }
                        if let liveNote {
                            Text(liveNote).font(.footnote).foregroundStyle(palette.danger)
                        }
                        if task.status == .completed, let span = ISO8601.doneIn(from: task.createdAt, to: task.completedAt) {
                            Text(span).font(.footnote).foregroundStyle(palette.muted)
                        }
                    }
                    Button("Delete task", role: .destructive) {
                        Task { await remove() }
                    }
                    .font(.subheadline)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 6)
                }
                .padding(16)
                .padding(.bottom, 24)
            }
            .background(palette.bg)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { Task { await save() } }
                }
            }
            .task { await load() }
            .onChange(of: timeOn) { _, on in
                guard on, DayStamp.isDateOnly(whenTime, accountTimeZone: model.user?.timezone) else { return }
                whenTime = DayStamp.at(hour: 9, on: when)
            }
            .onChange(of: deadlineTimeOn) { _, on in
                guard on, DayStamp.isDateOnly(deadlineTime, accountTimeZone: model.user?.timezone) else { return }
                deadlineTime = DayStamp.at(hour: 9, on: deadline)
            }
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(palette.border))
    }

    private var divider: some View {
        Rectangle().fill(palette.border).frame(height: 1)
    }

    private func detailRow<Control: View>(_ label: String, @ViewBuilder control: () -> Control) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Text(label).foregroundStyle(palette.muted)
            Spacer(minLength: 12)
            control()
        }
        .font(.subheadline)
    }

    private var bucketName: String {
        buckets.first { $0.id == bucketId }?.name ?? "Bucket"
    }

    private func load() async {
        title = task.title
        notes = task.notes ?? ""
        estimate = task.estimateMinutes.map(String.init) ?? ""
        waiting = task.waitingOn ?? ""
        if let raw = task.attentionDate, let parsed = ISO8601.date(raw) {
            whenOn = true
            when = parsed
            whenTime = parsed
            timeOn = !DayStamp.isDateOnly(parsed, accountTimeZone: model.user?.timezone)
        }
        if let raw = task.hardDeadline, let parsed = ISO8601.date(raw) {
            deadlineOn = true
            deadline = parsed
            deadlineTime = parsed
            deadlineTimeOn = !DayStamp.isDateOnly(parsed, accountTimeZone: model.user?.timezone)
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

    private func remove() async {
        try? await model.api.postVoid("tasks/\(task.id)/drop")
        await TaskActivity.stop(taskId: task.id)
        await onChange()
        dismiss()
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
            let attentionDate: String?
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
            attentionDate: whenOn ? ISO8601.string(DayStamp.combine(day: when, time: timeOn ? whenTime : nil)) : nil,
            hardDeadline: deadlineOn ? ISO8601.string(DayStamp.combine(day: deadline, time: deadlineTimeOn ? deadlineTime : nil)) : nil,
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

private struct ArchiveList: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @State private var tasks: [TaskItem] = []
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let error {
                Text(error).font(.footnote).foregroundStyle(palette.danger)
            }
            if tasks.isEmpty && error == nil {
                Text("Nothing archived.").foregroundStyle(palette.muted)
            }
            ForEach(tasks) { task in
                HStack(alignment: .center, spacing: 10) {
                    Text(task.title)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button("Put back") { Task { await restore(task.id) } }
                        .font(.caption.weight(.semibold))
                }
                .padding(12)
                .background(palette.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(palette.border))
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            tasks = try await model.api.get("tasks?view=archived")
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func restore(_ id: String) async {
        try? await model.api.postVoid("tasks/\(id)/reopen")
        NotificationCenter.default.post(name: .taskrTasksChanged, object: nil)
        await load()
    }
}
