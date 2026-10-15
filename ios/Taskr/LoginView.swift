import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @State private var mode = "login"
    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(Branding.appName)
                    .font(.largeTitle.bold())
                Text("Breathing room for your commitments.")
                    .foregroundStyle(palette.muted)

                if mode == "register" {
                    field("Name", text: $displayName)
                }
                field("Email", text: $email)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                SecureField("Password", text: $password)
                    .padding(12)
                    .background(palette.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(palette.border))

                if let error {
                    Text(error).foregroundStyle(palette.danger).font(.footnote)
                }

                Button(mode == "login" ? "Log in" : "Create account") {
                    Task { await submit() }
                }
                .buttonStyle(FillButtonStyle())
                .disabled(busy || email.isEmpty || password.isEmpty)

                Button(mode == "login" ? "Need an account? Register" : "Have an account? Log in") {
                    mode = mode == "login" ? "register" : "login"
                    error = nil
                }
                .font(.subheadline)

                Button("Try as guest") {
                    Task { await guest() }
                }
                .buttonStyle(FillButtonStyle())
                .disabled(busy)
                Text("No account — sample tasks, good for phone testing.")
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
            }
            .padding(24)
        }
    }

    private func field(_ title: String, text: Binding<String>) -> some View {
        TextField(title, text: text)
            .padding(12)
            .background(palette.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(palette.border))
    }

    private func submit() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            if mode == "login" {
                try await model.login(email: email, password: password)
            } else {
                try await model.register(email: email, password: password, displayName: displayName.isEmpty ? email : displayName)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func guest() async {
        busy = true
        error = nil
        defer { busy = false }
        do { try await model.guest() } catch { self.error = error.localizedDescription }
    }
}

struct FillButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(palette.accent.opacity(configuration.isPressed ? 0.8 : 1))
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
