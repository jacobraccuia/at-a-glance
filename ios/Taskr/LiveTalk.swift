import AVFoundation
import Combine
import SwiftUI
import UIKit
import WebRTC

private struct LiveReady: Decodable {
    let ready: Bool
}

private struct LiveAnswer: Decodable {
    let sdp: String
    let sessionId: String
    let conversationId: String
    let personalityId: String
}

private struct LivePoll: Decodable {
    let changeSeq: Int
}

private struct LiveConversation: Decodable {
    let id: String
    let personalityId: String
    let messages: [LiveLine]
}

private struct LiveLine: Decodable, Identifiable {
    let id: String
    let role: String
    let content: String

    init(id: String, role: String, content: String) {
        self.id = id
        self.role = role
        self.content = content
    }
}

private struct LiveTextResult: Decodable {
    let message: LiveLine
    let tasksChanged: Bool
}

private struct PersonalityOption: Decodable, Identifiable {
    let id: String
    let name: String
}

enum LivePhase: String {
    case connecting, listening, speaking, thinking, reconnecting, ended, failed
}

/// Full-duplex GPT-Live call. The server holds the API key and the sideband.
@MainActor
final class LiveCall: NSObject, ObservableObject, RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    @Published var phase: LivePhase = .ended {
        didSet {
            guard phase != oldValue else { return }
            if phase == .listening { armSilence() } else { silence?.cancel() }
        }
    }
    @Published var caption = ""
    /// The turn still being spoken. Older turns stay in `lines`.
    @Published var liveRole: String?
    @Published var liveText = ""
    @Published fileprivate var lines: [LiveLine] = []
    @Published var personalityName = "Puck"
    @Published var errorText: String?
    let conversationId: String

    private let api: APIClient
    private var factory: RTCPeerConnectionFactory?
    private var pc: RTCPeerConnection?
    private var channel: RTCDataChannel?
    private var sessionId: String?
    private var attempts = 0
    private var poll: Task<Void, Never>?
    private var seenChange = -1
    @Published var micLevel = 0.0
    var accentHex = "#2f5bd3"
    var onTasksChanged: (() -> Void)?
    var onSilence: (() -> Void)?
    let mic: HeldMic
    private var speakReset: Task<Void, Never>?
    private var silence: Task<Void, Never>?
    private var stopped = false
    private var iceWait: CheckedContinuation<Void, Never>?
    private var audioWatch: [AnyCancellable] = []

    init(api: APIClient, conversationId: String, mic: HeldMic) {
        self.api = api
        self.conversationId = conversationId
        self.mic = mic
        super.init()
        mic.onLevel = { [weak self] value in self?.micLevel = value }
    }

    func start() {
        stopped = false
        attempts = 0
        watchAudio()
        mic.start()
        mic.hold()
        Task { await connect(retry: false) }
    }

    func stop() {
        stopped = true
        silence?.cancel()
        audioWatch.removeAll()
        poll?.cancel()
        speakReset?.cancel()
        let id = sessionId
        sessionId = nil
        channel = nil
        pc?.close()
        pc = nil
        mic.stop()
        phase = .ended
        if let id {
            Task { try? await api.delete("assistant/live/sessions/\(id)") }
        }
    }

    /// Nobody has spoken for 20s. End the paid line.
    private func armSilence() {
        silence?.cancel()
        guard !stopped, sessionId != nil else { return }
        silence = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            guard let self, !Task.isCancelled, !self.stopped, self.phase == .listening else { return }
            self.stop()
            self.onSilence?()
        }
    }

    func interrupt() {
        let payload: [String: Any] = [
            "type": "session.instructions.append",
            "event_id": "stop-\(Int(Date().timeIntervalSince1970))",
            "delegation_id": NSNull(),
            "content": "The user interrupted. Stop speaking now and listen.",
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        channel?.sendData(RTCDataBuffer(data: data, isBinary: false))
        commitSpoken()
        phase = .listening
    }

    private func connect(retry: Bool) async {
        phase = retry ? .reconnecting : .connecting
        mic.hold()
        errorText = nil
        let ready: LiveReady? = try? await api.get("assistant/live/ready")
        if stopped { return }
        if ready?.ready != true {
            phase = .failed
            errorText = "Voice needs the server key. You can still type."
            return
        }
        mic.reactivate()
        let factory = RTCPeerConnectionFactory(encoderFactory: nil, decoderFactory: nil, audioDevice: mic)
        self.factory = factory
        let config = RTCConfiguration()
        config.sdpSemantics = .unifiedPlan
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let pc = factory.peerConnection(with: config, constraints: constraints, delegate: self) else {
            phase = .failed
            errorText = "Could not open audio."
            return
        }
        self.pc = pc
        let audio = factory.audioTrack(with: factory.audioSource(with: constraints), trackId: "taskr-mic")
        audio.isEnabled = true
        pc.add(audio, streamIds: ["taskr"])
        let dcConfig = RTCDataChannelConfiguration()
        dcConfig.isOrdered = true
        channel = pc.dataChannel(forLabel: "oai-events", configuration: dcConfig)
        channel?.delegate = self
        let offerConstraints = RTCMediaConstraints(
            mandatoryConstraints: ["OfferToReceiveAudio": "true"],
            optionalConstraints: nil
        )
        let offer: RTCSessionDescription? = await withCheckedContinuation { continuation in
            pc.offer(for: offerConstraints) { sdp, _ in continuation.resume(returning: sdp) }
        }
        guard let offer else {
            phase = .failed
            errorText = "Could not start the call."
            return
        }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            pc.setLocalDescription(offer) { _ in continuation.resume() }
        }
        await waitForIce()
        guard !stopped, let sdp = pc.localDescription?.sdp else { return }
        do {
            let answer: LiveAnswer = try await api.post(
                "assistant/live/sessions",
                body: LiveOffer(sdp: sdp, conversationId: conversationId)
            )
            if stopped {
                try? await api.delete("assistant/live/sessions/\(answer.sessionId)")
                return
            }
            sessionId = answer.sessionId
            let remote = RTCSessionDescription(type: .answer, sdp: answer.sdp)
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                pc.setRemoteDescription(remote) { _ in continuation.resume() }
            }
            await waitUntilSendable()
            guard !stopped else { return }
            mic.forward()
            phase = .listening
            attempts = 0
            startPoll()
        } catch {
            phase = .failed
            let text = error.localizedDescription
            errorText = text.contains("live_unavailable") ? "Voice needs the server key. You can still type." : text
        }
    }

    private func configureAudio() {
        mic.reactivate()
    }

    /// Hold captured speech until the transport can actually carry it.
    private func waitUntilSendable() async {
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline {
            if stopped { return }
            let ice = pc?.iceConnectionState
            let link = pc?.connectionState
            if ice == .connected || ice == .completed || link == .connected { return }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
    }

    /// Leaving the app interrupts the audio route. Turn it back on instead of ending the call.
    private func watchAudio() {
        audioWatch.removeAll()
        let names = [
            UIApplication.didEnterBackgroundNotification,
            UIApplication.willEnterForegroundNotification,
            AVAudioSession.interruptionNotification,
        ]
        for name in names {
            audioWatch.append(NotificationCenter.default.publisher(for: name).sink { [weak self] note in
                Task { @MainActor in self?.resumeAudio(note) }
            })
        }
    }

    private func resumeAudio(_ note: Notification) {
        guard !stopped else { return }
        if note.name == AVAudioSession.interruptionNotification {
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            if raw == AVAudioSession.InterruptionType.began.rawValue { return }
        }
        configureAudio()
    }

    private func waitForIce() async {
        if pc?.iceGatheringState == .complete { return }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            iceWait = continuation
            Task {
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                self.finishIce()
            }
        }
    }

    private func finishIce() {
        guard let waiting = iceWait else { return }
        iceWait = nil
        waiting.resume()
    }

    private func startPoll() {
        poll?.cancel()
        seenChange = -1
        poll = Task { [weak self] in
            while let self, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                guard let id = self.sessionId else { return }
                if let row: LivePoll = try? await self.api.get("assistant/live/sessions/\(id)") {
                    if self.seenChange >= 0, row.changeSeq != self.seenChange {
                        self.seenChange = row.changeSeq
                        await self.reloadLines()
                        self.onTasksChanged?()
                        await TodayGlance.refresh(api: self.api, accentHex: self.accentHex)
                    } else {
                        self.seenChange = row.changeSeq
                    }
                }
            }
        }
    }

    func reloadLines() async {
        if let conversation: LiveConversation = try? await api.get("assistant/live/conversation"),
           conversation.id == conversationId {
            lines = conversation.messages
            let spoken = liveText.trimmingCharacters(in: .whitespacesAndNewlines)
            if let last = lines.last, last.role == liveRole, last.content == spoken {
                liveRole = nil
                liveText = ""
                caption = ""
            }
        }
    }

    private func appendSpoken(role: String, delta: String) {
        if let liveRole, liveRole != role { commitSpoken() }
        liveRole = role
        liveText += delta
        caption = liveText
    }

    private func commitSpoken() {
        let text = liveText.trimmingCharacters(in: .whitespacesAndNewlines)
        if let liveRole, !text.isEmpty, lines.last?.content != text || lines.last?.role != liveRole {
            lines.append(LiveLine(id: "live-\(UUID().uuidString)", role: liveRole, content: text))
        }
        liveRole = nil
        liveText = ""
        caption = ""
    }

    func sendText(_ text: String) async -> Bool {
        struct Body: Encodable { let text: String; let conversationId: String }
        do {
            let result: LiveTextResult = try await api.post(
                "assistant/live/text",
                body: Body(text: text, conversationId: conversationId)
            )
            lines.append(result.message)
            return result.tasksChanged
        } catch {
            errorText = error.localizedDescription
            return false
        }
    }

    private func handle(_ raw: String) {
        guard let data = raw.data(using: .utf8),
              let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = event["type"] as? String else { return }
        if type == "session.output_transcript.delta", let delta = event["delta"] as? String {
            phase = .speaking
            appendSpoken(role: "assistant", delta: delta)
            speakReset?.cancel()
            speakReset = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                if self?.phase == .speaking { self?.phase = .listening }
            }
        } else if type == "session.input_transcript.delta" {
            phase = .listening
            appendSpoken(role: "user", delta: event["delta"] as? String ?? "")
        } else if type == "session.delegation.created" {
            phase = .thinking
        } else if type == "session.paused" || type == "session.resumed" {
            phase = .listening
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        if newState == .complete {
            Task { @MainActor in self.finishIce() }
        }
    }
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        guard newState == .failed || newState == .disconnected else { return }
        Task { @MainActor in
            guard !self.stopped else { return }
            if self.phase == .listening {
                self.stop()
                self.onSilence?()
                return
            }
            if self.attempts >= 3 {
                self.phase = .failed
                self.errorText = "The call dropped. Try again."
                return
            }
            self.attempts += 1
            let id = self.sessionId
            self.sessionId = nil
            self.pc?.close()
            if let id { try? await self.api.delete("assistant/live/sessions/\(id)") }
            await self.connect(retry: true)
        }
    }
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {}
    nonisolated func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        guard let text = String(data: buffer.data, encoding: .utf8) else { return }
        Task { @MainActor in self.handle(text) }
    }
}

private struct LiveOffer: Encodable {
    let sdp: String
    let conversationId: String
}

struct LiveTalkSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @StateObject private var callHolder = LiveCallHolder()
    @State private var draft = ""
    @State private var ready = false
    @State private var bootError: String?
    @State private var minimized = false
    @State private var earlyMic = HeldMic()

    var body: some View {
        Group {
            if minimized {
                minimizedPill
            } else {
                conversation
            }
        }
        .task { await boot() }
        .onDisappear {
            callHolder.call?.stop()
            earlyMic.stop()
        }
    }

    private var conversation: some View {
        VStack(spacing: 0) {
            Capsule().fill(palette.border).frame(width: 36, height: 4).padding(.top, 10)
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Image(systemName: PersonalityMark.symbol(for: callHolder.call?.personalityName ?? "Puck"))
                            .foregroundStyle(palette.accent)
                        Text(callHolder.call?.personalityName ?? "Puck").font(.headline)
                    }
                }
                Spacer()
                sheetIcon("chevron.down", "Minimize") { minimized = true }
                sheetIcon("xmark", "Close") { model.talkOpen = false }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(callHolder.call?.lines ?? []) { line in
                            bubble(line.content, role: line.role).id(line.id)
                        }
                        if let live = callHolder.call?.liveText, !live.isEmpty {
                            bubble(live, role: callHolder.call?.liveRole ?? "assistant").id("live-tail")
                        }
                        if let error = bootError ?? callHolder.call?.errorText {
                            Text(error).font(.footnote).foregroundStyle(palette.danger)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: callHolder.call?.lines.count ?? 0) { _, _ in scroll(proxy) }
                .onChange(of: callHolder.call?.liveText ?? "") { _, _ in scroll(proxy) }
            }

            personaOrb

            HStack(spacing: 8) {
                TextField("Or type", text: $draft)
                    .submitLabel(.send)
                    .onSubmit { Task { await send() } }
                Button { Task { await send() } } label: {
                    Image(systemName: "arrow.right")
                        .font(.body.weight(.semibold))
                        .frame(width: 36, height: 36)
                        .background(palette.accent)
                        .foregroundStyle(.white)
                        .clipShape(Circle())
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Send")
            }
            .padding(8)
            .background(palette.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(palette.border))
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.bg)
    }

    /// Small return handle. The call keeps running so the board stays usable.
    private var minimizedPill: some View {
        HStack(spacing: 10) {
            PersonaOrb(
                name: callHolder.call?.personalityName ?? "Puck",
                level: callHolder.call?.micLevel ?? 0,
                live: hearing,
                speaking: callHolder.call?.phase == .speaking,
                mini: true
            )
            Text(callHolder.call?.personalityName ?? "Puck")
                .font(.subheadline.weight(.semibold))
            Button { minimized = false } label: {
                Image(systemName: "chevron.up")
                    .font(.body.weight(.semibold))
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel("Show conversation")
            Button { model.talkOpen = false } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel("Close")
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(palette.border))
        .padding(.horizontal, 16)
        .offset(y: -168)
    }

    /// Accent only after the session is up and the mic is being sent.
    private var hearing: Bool {
        switch callHolder.call?.phase {
        case .listening, .speaking, .thinking: return true
        default: return false
        }
    }

    /// Floating persona. Brighter once captured speech is actually being sent.
    private var personaOrb: some View {
        VStack(spacing: 8) {
            PersonaOrb(
                name: callHolder.call?.personalityName ?? "Puck",
                level: callHolder.call?.micLevel ?? 0,
                live: hearing,
                speaking: callHolder.call?.phase == .speaking
            )
            if callHolder.call?.phase == .speaking {
                Button("Stop") { callHolder.call?.interrupt() }
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(palette.surface)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(palette.border))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(hearing ? "Listening" : "Connecting")
    }

    private func sheetIcon(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .frame(width: 36, height: 36)
                .background(palette.surface)
                .clipShape(Circle())
                .overlay(Circle().stroke(palette.border))
        }
        .accessibilityLabel(label)
    }

    private func bubble(_ text: String, role: String) -> some View {
        Text(text)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .foregroundStyle(role == "user" ? Color.white : palette.ink)
            .background(role == "user" ? palette.accent : palette.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay {
                if role != "user" {
                    RoundedRectangle(cornerRadius: 18).stroke(palette.border)
                }
            }
            .frame(maxWidth: 300, alignment: role == "user" ? .trailing : .leading)
            .frame(maxWidth: .infinity, alignment: role == "user" ? .trailing : .leading)
    }

    private func scroll(_ proxy: ScrollViewProxy) {
        let target = (callHolder.call?.liveText.isEmpty == false) ? "live-tail" : callHolder.call?.lines.last?.id
        guard let target else { return }
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(target, anchor: .bottom)
        }
    }

    private func boot() async {
        guard !ready else { return }
        ready = true
        earlyMic.start()
        do {
            let conversation: LiveConversation = try await model.api.get("assistant/live/conversation")
            let people: [PersonalityOption] = (try? await model.api.get("assistant/personalities")) ?? []
            let call = LiveCall(api: model.api, conversationId: conversation.id, mic: earlyMic)
            call.lines = conversation.messages
            call.accentHex = model.accentHex
            call.onTasksChanged = { model.boardRevision += 1 }
            call.onSilence = { model.talkOpen = false }
            call.personalityName = people.first { $0.id == conversation.personalityId }?.name ?? "Puck"
            callHolder.call = call
            call.start()
        } catch {
            bootError = "Voice couldn't reach the server. You can still type."
        }
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let call = callHolder.call else { return }
        draft = ""
        let changed = await call.sendText(text)
        if changed {
            model.boardRevision += 1
            await TodayGlance.refresh(api: model.api, accentHex: model.accentHex)
        }
    }
}

/// Holds the call so the view can create it after the conversation id arrives.
@MainActor
final class LiveCallHolder: ObservableObject {
    @Published var call: LiveCall? {
        didSet { observeCall() }
    }

    private var sink: AnyCancellable?

    private func observeCall() {
        sink = call?.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
    }
}
