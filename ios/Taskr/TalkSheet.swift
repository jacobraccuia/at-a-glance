import AVFoundation
import Speech
import SwiftUI

struct TalkSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @StateObject private var mic = SpeechListener()
    @StateObject private var voice = TalkVoice()
    @State private var messages: [ChatMessage] = []
    @State private var conversationId: String?
    @State private var draft = ""
    @State private var caption = ""
    @State private var face = "live"
    @State private var sending = false
    @State private var error: String?
    @State private var dragY: CGFloat = 0

    var body: some View {
        VStack(spacing: 0) {
            Capsule().fill(palette.border).frame(width: 40, height: 5).padding(.top, 8)
                .gesture(sheetDrag)
            HStack {
                VStack(alignment: .leading) {
                    Text(Branding.assistantName).font(.headline)
                    if face == "thread" {
                        Text(status).font(.caption).foregroundStyle(palette.muted)
                    }
                }
                Spacer()
                Button("New") { Task { await newChat() } }
                Button {
                    voice.stop()
                    mic.stop()
                    model.talkOpen = false
                } label: {
                    Image(systemName: "xmark")
                }
                .accessibilityLabel("Close")
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .gesture(sheetDrag)

            if face == "live" {
                Spacer()
                Button {
                    if voice.speaking { voice.stop() }
                } label: {
                    ZStack {
                        Circle()
                            .fill(palette.accent.opacity(mic.hearing || voice.speaking ? 0.25 : 0.12))
                            .frame(width: 180, height: 180)
                        Circle()
                            .fill(voice.speaking || mic.hearing ? palette.accent : palette.accentSoft)
                            .frame(width: 128, height: 128)
                            .shadow(color: palette.accent.opacity(0.45), radius: mic.hearing || voice.speaking ? 24 : 8)
                        Image(systemName: "mic.fill")
                            .font(.largeTitle)
                            .foregroundStyle(voice.speaking || mic.hearing ? Color.white : palette.accent)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(voice.speaking ? "Stop talking and listen" : "Listening")
                Text(status).foregroundStyle(palette.muted)
                Text(voice.speaking ? caption : mic.partial)
                    .font(.title3)
                    .multilineTextAlignment(.center)
                    .frame(minHeight: 72)
                    .padding(.horizontal, 28)
                if !mic.partial.isEmpty && !sending && !voice.speaking {
                    Button("Send now") { mic.flush() }
                        .font(.subheadline)
                }
                if !messages.isEmpty && !sending && !voice.speaking {
                    Button("Conversation") { face = "thread" }
                        .font(.subheadline)
                }
                Spacer()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(messages) { message in
                            Text(message.content)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
                                .background(message.role == "user" ? palette.accentSoft : palette.surface)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                            if let undos = message.actions?.compactMap(\.undo) {
                                ForEach(undos, id: \.taskId) { item in
                                    Button("Undo") { Task { await undo(item) } }
                                        .font(.caption)
                                }
                            }
                        }
                        Button("Back to talking") { face = "live" }
                            .font(.subheadline)
                    }
                    .padding(16)
                }
            }

            if let error {
                Text(error).font(.footnote).foregroundStyle(palette.danger).padding(.horizontal)
            }

            HStack {
                TextField("Or type…", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                Button {
                    Task { await send(draft) }
                } label: {
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.title2)
                        .foregroundStyle(palette.accent)
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
            }
            .padding(12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .padding(.top, 48)
        .offset(y: dragY)
        .task { await open() }
        .onChange(of: mic.heard) { _, _ in
            let text = mic.heardText
            guard !text.isEmpty else { return }
            Task { await send(text) }
        }
    }

    private var sheetDrag: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                dragY = max(0, value.translation.height)
            }
            .onEnded { value in
                if value.translation.height > 90 {
                    voice.stop()
                    mic.stop()
                    model.talkOpen = false
                }
                dragY = 0
            }
    }

    private var status: String {
        if sending { return "Thinking…" }
        if voice.speaking { return "Talking… tap the glow to cut in" }
        if mic.hearing { return "Hearing you" }
        if mic.ready { return "Listening" }
        return mic.supported ? "Starting mic…" : "Type your message"
    }

    private func open() async {
        face = "live"
        do {
            let conversation: ConversationPayload = try await model.api.get("assistant/conversation")
            conversationId = conversation.id
            messages = conversation.messages.map {
                ChatMessage(id: $0.id, role: $0.role, content: $0.content, actions: $0.actions)
            }
        } catch {
            self.error = error.localizedDescription
        }
        mic.start()
    }

    private func send(_ raw: String) async {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        voice.stop()
        mic.pause()
        sending = true
        draft = ""
        caption = ""
        face = "live"
        error = nil
        messages.append(ChatMessage(id: "temp-\(UUID().uuidString)", role: "user", content: text))
        struct Body: Encodable { let text: String; let conversationId: String? }
        do {
            let reply: AssistantReply = try await model.api.post(
                "assistant/message",
                body: Body(text: text, conversationId: conversationId)
            )
            conversationId = reply.conversationId
            messages.removeAll { $0.id.hasPrefix("temp-") }
            messages.append(ChatMessage(id: UUID().uuidString, role: "user", content: text))
            messages.append(ChatMessage(id: reply.message.id, role: "assistant", content: reply.message.content, actions: reply.executed))
            let line = reply.spoken?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                ? reply.spoken!
                : reply.message.content
            await voice.speak(line, api: model.api) { spoken in
                caption = spoken
            }
            caption = ""
            face = "thread"
        } catch {
            messages.removeAll { $0.id.hasPrefix("temp-") }
            self.error = error.localizedDescription
            draft = text
        }
        sending = false
        mic.resume()
    }

    private func newChat() async {
        voice.stop()
        struct Body: Encodable { let note: String? }
        if let created: ConversationPayload = try? await model.api.post("assistant/conversation/new", body: Body(note: nil)) {
            conversationId = created.id
            messages = []
            face = "live"
        }
    }

    private func undo(_ item: ExecutedAction.UndoPayload) async {
        struct Body: Encodable { let kind: String; let taskId: String }
        try? await model.api.postVoid("assistant/undo", body: Body(kind: item.kind, taskId: item.taskId))
        messages.append(ChatMessage(id: UUID().uuidString, role: "assistant", content: "Undone."))
        await voice.speak("Undone.", api: model.api) { caption = $0 }
        face = "thread"
    }
}

@MainActor
final class SpeechListener: ObservableObject {
    @Published var partial = ""
    @Published var hearing = false
    @Published var ready = false
    @Published var heard = 0
    private(set) var heardText = ""
    let supported = SFSpeechRecognizer(locale: Locale.current) != nil

    private let recognizer = SFSpeechRecognizer(locale: Locale.current)
    private let audio = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silence: Task<Void, Never>?
    private var paused = false
    private var tapOn = false

    func start() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            Task { @MainActor in
                guard status == .authorized else { return }
                self?.listen()
            }
        }
    }

    func pause() {
        paused = true
        silence?.cancel()
        partial = ""
        hearing = false
    }

    func resume() {
        paused = false
        if task == nil { listen() }
    }

    func flush() {
        silence?.cancel()
        let text = partial.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !paused else { return }
        heardText = text
        heard += 1
        partial = ""
        hearing = false
    }

    func stop() {
        silence?.cancel()
        stopEngineOnly()
        ready = false
        hearing = false
    }

    private func listen() {
        guard let recognizer, recognizer.isAvailable, !paused else { return }
        stopEngineOnly()
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth])
        try? session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = false
        }
        self.request = request
        let input = audio.inputNode
        let format = input.outputFormat(forBus: 0)
        if tapOn {
            input.removeTap(onBus: 0)
            tapOn = false
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        tapOn = true
        audio.prepare()
        try? audio.start()
        ready = true
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self, !self.paused else { return }
                if let result {
                    let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                    self.partial = text
                    self.hearing = !text.isEmpty
                    self.armSilence(final: result.isFinal)
                }
                if error != nil {
                    self.ready = false
                }
            }
        }
    }

    private func armSilence(final: Bool) {
        silence?.cancel()
        silence = Task { [weak self] in
            try? await Task.sleep(nanoseconds: final ? 200_000_000 : 1_200_000_000)
            await MainActor.run {
                guard let self, !self.paused else { return }
                let text = self.partial.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return }
                self.heardText = text
                self.heard += 1
                self.partial = ""
                self.hearing = false
            }
        }
    }

    private func stopEngineOnly() {
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        if audio.isRunning { audio.stop() }
        if tapOn {
            audio.inputNode.removeTap(onBus: 0)
            tapOn = false
        }
    }
}

@MainActor
final class TalkVoice: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published var speaking = false
    private var player: AVAudioPlayer?
    private var synth = AVSpeechSynthesizer()
    private var finish: CheckedContinuation<Void, Never>?

    func speak(_ text: String, api: APIClient, onWords: @escaping (String) -> Void) async {
        stop()
        speaking = true
        let words = text.split(separator: " ")
        let reveal = Task { @MainActor in
            var shown: [Substring] = []
            for word in words {
                if Task.isCancelled { return }
                shown.append(word)
                onWords(shown.joined(separator: " "))
                try? await Task.sleep(nanoseconds: 180_000_000)
            }
        }
        struct Body: Encodable { let text: String }
        let started = Date()
        if let data = try? await api.data("assistant/speak", json: Body(text: text)),
           Date().timeIntervalSince(started) < 0.7,
           let audio = try? AVAudioPlayer(data: data) {
            player = audio
            audio.delegate = self
            audio.play()
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                finish = cont
            }
        } else {
            let utterance = AVSpeechUtterance(string: text)
            utterance.rate = 0.5
            synth.speak(utterance)
            let seconds = max(0.8, Double(text.count) * 0.06)
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        }
        reveal.cancel()
        speaking = false
    }

    func stop() {
        player?.stop()
        synth.stopSpeaking(at: .immediate)
        speaking = false
        if let finish {
            self.finish = nil
            finish.resume()
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            speaking = false
            if let finish {
                self.finish = nil
                finish.resume()
            }
        }
    }
}
