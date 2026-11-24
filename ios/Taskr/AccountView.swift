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
                    HStack {
                        Circle()
                            .fill(Color(hex: bucket.color) ?? palette.muted)
                            .frame(width: 10, height: 10)
                        Text(bucket.name)
                            .foregroundStyle(bucket.archivedAt == nil ? palette.ink : palette.muted)
                        Spacer()
                        if bucket.archivedAt == nil {
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
        .task { await load() }
        .onChange(of: nudgeTime) { _, date in
            MorningNudge.minutesFromMidnight = MorningNudge.minutes(from: date)
            Task { await TodayGlance.refresh(api: model.api, accentHex: model.accentHex) }
        }
    }

    private func load() async {
        buckets = (try? await model.api.get("buckets?includeArchived=true")) ?? []
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        nudgeDenied = settings.authorizationStatus == .denied
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

    private func setArchived(_ bucket: Bucket, archived: Bool) async {
        let path = archived ? "buckets/\(bucket.id)/archive" : "buckets/\(bucket.id)/unarchive"
        try? await model.api.postVoid(path)
        await load()
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
