import SwiftUI
import UIKit
import UserNotifications

struct AccountView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @State private var buckets: [Bucket] = []
    @State private var newName = ""
    @State private var newColor = Color(red: 0.30, green: 0.62, blue: 0.44)
    @State private var error: String?
    @State private var nudgeDenied = false
    @State private var nudgeTime = MorningNudge.timeDate
    @State private var assistantChoices = AssistantChoice.builtin
    @State private var personalityId = "puck"
    @State private var memories: [MemoryRow] = []
    @State private var voiceUsage: UsageRow?
    @State private var personalityError: String?

    var body: some View {
        List {
            Section {
                Text(model.user?.isGuest == true ? "Guest" : (model.user?.displayName ?? ""))
                    .foregroundStyle(palette.muted)
                Picker("Look", selection: $model.paletteChoice) {
                    ForEach(PaletteChoice.allCases) { choice in
                        Text(choice.label).tag(choice)
                    }
                }
            } header: {
                Text("Account")
            }

            Section("Buckets") {
                ForEach(buckets) { bucket in
                    BucketRenameRow(bucket: bucket, onRename: { name in
                        await rename(bucket, name: name)
                    }) {
                        if bucket.isDefault {
                            EmptyView()
                        } else if bucket.archivedAt == nil {
                            Button("Archive") { Task { await setArchived(bucket, archived: true) } }
                                .font(.caption)
                        } else {
                            Button("Unarchive") { Task { await setArchived(bucket, archived: false) } }
                                .font(.caption)
                        }
                    }
                }
                HStack {
                    TextField("New bucket", text: $newName)
                    ColorPicker("Color", selection: $newColor, supportsOpacity: false)
                        .labelsHidden()
                    Button("Add") { Task { await createBucket() } }
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }

            Section("Assistant") {
                ForEach(assistantChoices) { choice in
                    Button {
                        Task { await choosePersonality(choice.id) }
                    } label: {
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(choice.name).foregroundStyle(palette.ink)
                                Text(choice.description)
                                    .font(.caption)
                                    .foregroundStyle(palette.muted)
                            }
                            Spacer(minLength: 8)
                            if personalityId == choice.id {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(palette.accent)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
                Text("\(assistantChoices.first { $0.id == personalityId }?.name ?? "Puck") on the next call. Voice changes when Talk reconnects.")
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                if let personalityError {
                    Text(personalityError).font(.footnote).foregroundStyle(palette.danger)
                }
                if let voiceUsage {
                    Text("Voice this month: $\(String(format: "%.2f", voiceUsage.estimatedUsd)) of $\(Int(voiceUsage.budgetUsd))\(voiceUsage.warning ? " — over the soft budget." : ".")")
                        .font(.footnote)
                        .foregroundStyle(palette.muted)
                }
                ForEach(memories) { memory in
                    HStack {
                        Text("\(memory.text) (\(memory.source))")
                        Spacer()
                        Button("Delete") {
                            Task { await removeMemory(memory.id) }
                        }
                        .font(.caption)
                    }
                }
                if !memories.isEmpty {
                    Button("Delete all memory", role: .destructive) {
                        Task { await clearMemory() }
                    }
                }
            }

            Section("Morning") {
                Toggle("One nudge", isOn: Binding(
                    get: { MorningNudge.enabled },
                    set: { on in
                        MorningNudge.enabled = on
                        Task { await applyNudge(on) }
                    }
                ))
                DatePicker("Time", selection: $nudgeTime, displayedComponents: .hourAndMinute)
                Text("One note if Today has something. Quiet if the day is empty, or if you already opened the app. The widget stays either way.")
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                if nudgeDenied {
                    Text("Notifications are off in Settings.")
                        .font(.footnote)
                        .foregroundStyle(palette.danger)
                }
            }

            if let error {
                Text(error).foregroundStyle(palette.danger).font(.footnote)
            }

            Section {
                Button(model.user?.isGuest == true ? "End guest" : "Log out", role: .destructive) {
                    Task { await model.logout() }
                }
            }
        }
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .task { await load() }
        .onChange(of: nudgeTime) { _, date in
            MorningNudge.minutesFromMidnight = MorningNudge.minutes(from: date)
            Task { await TodayGlance.refresh(api: model.api, accentHex: model.accentHex) }
        }
    }

    private func load() async {
        buckets = (try? await model.api.get("buckets?includeArchived=true")) ?? []
        if let remote: [AssistantChoice] = try? await model.api.get("assistant/personalities"), !remote.isEmpty {
            assistantChoices = remote
        }
        memories = (try? await model.api.get("assistant/memory")) ?? []
        voiceUsage = try? await model.api.get("assistant/live/usage")
        let me: MePersonality? = try? await model.api.get("auth/me")
        if let id = me?.personalityId { personalityId = id }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        nudgeDenied = settings.authorizationStatus == .denied
    }

    private func choosePersonality(_ id: String) async {
        let previous = personalityId
        personalityId = id
        personalityError = nil
        do {
            let _: MePersonality = try await model.api.patch("assistant/personality", body: PersonalityBody(id: id))
        } catch {
            personalityId = previous
            personalityError = error.localizedDescription
        }
    }

    private func removeMemory(_ id: String) async {
        try? await model.api.delete("assistant/memory/\(id)")
        memories.removeAll { $0.id == id }
    }

    private func clearMemory() async {
        try? await model.api.delete("assistant/memory")
        memories = []
    }

    private func applyNudge(_ on: Bool) async {
        if on {
            let ok = await MorningNudge.requestPermission()
            nudgeDenied = !ok
        }
        await TodayGlance.refresh(api: model.api, accentHex: model.accentHex)
    }

    private func createBucket() async {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        struct Body: Encodable { let name: String; let color: String }
        do {
            let _: Bucket = try await model.api.post("buckets", body: Body(name: name, color: newColor.hexRGB))
            newName = ""
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func rename(_ bucket: Bucket, name: String) async {
        let next = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !next.isEmpty, next != bucket.name else { return }
        struct Body: Encodable { let name: String }
        do {
            let _: Bucket = try await model.api.patch("buckets/\(bucket.id)", body: Body(name: next))
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func setArchived(_ bucket: Bucket, archived: Bool) async {
        let path = archived ? "buckets/\(bucket.id)/archive" : "buckets/\(bucket.id)/unarchive"
        try? await model.api.postVoid(path)
        await load()
    }
}

private struct BucketRenameRow<Trailing: View>: View {
    let bucket: Bucket
    var onRename: (String) async -> Void
    @ViewBuilder var trailing: () -> Trailing
    @State private var name: String

    init(bucket: Bucket, onRename: @escaping (String) async -> Void, @ViewBuilder trailing: @escaping () -> Trailing) {
        self.bucket = bucket
        self.onRename = onRename
        self.trailing = trailing
        _name = State(initialValue: bucket.name)
    }

    var body: some View {
        HStack {
            Circle()
                .fill(Color(hex: bucket.color) ?? .gray)
                .frame(width: 10, height: 10)
            TextField("Name", text: $name)
                .onSubmit { Task { await onRename(name) } }
            trailing()
        }
    }
}

private extension Color {
    init?(hex: String?) {
        guard var raw = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        if raw.hasPrefix("#") { raw.removeFirst() }
        guard raw.count == 6, let value = Int(raw, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    var hexRGB: String {
        let ui = UIColor(self)
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: nil)
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
    }
}

private struct AssistantChoice: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String

    static let builtin: [AssistantChoice] = [
        AssistantChoice(id: "puck", name: "Puck", description: "A mischievous companion for everyday chaos."),
        AssistantChoice(id: "atlas", name: "Atlas", description: "Calm, grounded, and direct."),
        AssistantChoice(id: "sage", name: "Sage", description: "Patient and reflective."),
        AssistantChoice(id: "mercury", name: "Mercury", description: "Energetic and practical about next steps."),
        AssistantChoice(id: "logos", name: "Logos", description: "A precise command interface."),
    ]
}

private struct MemoryRow: Decodable, Identifiable {
    let id: String
    let text: String
    let source: String
}

private struct UsageRow: Decodable {
    let estimatedUsd: Double
    let budgetUsd: Double
    let warning: Bool
}

private struct PersonalityBody: Encodable {
    let id: String
}

private struct MePersonality: Decodable {
    let personalityId: String?
}
