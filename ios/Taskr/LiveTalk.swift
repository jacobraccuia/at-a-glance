import AVFoundation
import Combine
import SwiftUI
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
    @Published var phase: LivePhase = .ended
    @Published var caption = ""
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
    var accentHex = "#2f5bd3"
    var onTasksChanged: (() -> Void)?
    private var speakReset: Task<Void, Never>?
    private var stopped = false
    private var iceWait: CheckedContinuation<Void, Never>?

    init(api: APIClient, conversationId: String) {
        self.api = api
        self.conversationId = conversationId
        super.init()
    }

    func start() {
        stopped = false
        attempts = 0
        Task { await connect(retry: false) }
    }

    func stop() {
        stopped = true
        poll?.cancel()
        speakReset?.cancel()
        let id = sessionId
        sessionId = nil
        channel = nil
        pc?.close()
        pc = nil
        RTCAudioSession.sharedInstance().isAudioEnabled = false
        phase = .ended
        if let id {
            Task { try? await api.delete("assistant/live/sessions/\(id)") }
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
        phase = .listening
        caption = ""
    }

    private func connect(retry: Bool) async {
        phase = retry ? .reconnecting : .connecting
        errorText = nil
        let ready: LiveReady? = try? await api.get("assistant/live/ready")
        if stopped { return }
        if ready?.ready != true {
            phase = .failed
            errorText = "Voice needs the server key. You can still type."
            return
        }
        configureAudio()
        let factory = RTCPeerConnectionFactory()
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
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        do {
            try session.setCategory(.playAndRecord, with: [.defaultToSpeaker, .allowBluetoothHFP])
            try session.setMode(.voiceChat)
            try session.setActive(true)
        } catch {
            errorText = error.localizedDescription
        }
        session.unlockForConfiguration()
        session.isAudioEnabled = true
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
        }
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
            caption += delta
            speakReset?.cancel()
            speakReset = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                if self?.phase == .speaking { self?.phase = .listening }
            }
        } else if type == "session.input_transcript.delta" {
            phase = .listening
            caption = ""
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
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var callHolder = LiveCallHolder()
    @State private var draft = ""
    @State private var ready = false

    var body: some View {
        VStack(spacing: 0) {
            Capsule().fill(palette.border).frame(width: 36, height: 4).padding(.top, 8)
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(callHolder.call?.personalityName ?? "Puck").font(.headline)
                    Text(phaseLabel).font(.caption).foregroundStyle(palette.muted)
                }
                Spacer()
                Button("Quick talk") { model.talkKind = .quick }
                    .font(.caption)
                Button("Close") { model.talkOpen = false }
                    .font(.caption)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)

            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(callHolder.call?.lines ?? []) { line in
                        Text(line.content)
                            .frame(maxWidth: .infinity, alignment: line.role == "user" ? .trailing : .leading)
                    }
                    if let caption = callHolder.call?.caption, !caption.isEmpty {
                        Text(caption).foregroundStyle(palette.muted)
                    }
                    if let error = callHolder.call?.errorText {
                        Text(error).font(.footnote).foregroundStyle(palette.danger)
                    }
                }
                .padding(16)
            }

            HStack {
                Button("Stop speaking") { callHolder.call?.interrupt() }
                    .disabled(callHolder.call?.phase != .speaking)
                TextField("Or type", text: $draft)
                    .textFieldStyle(.roundedBorder)
                Button("Send") { Task { await send() } }
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.bg)
        .task { await boot() }
        .onDisappear { callHolder.call?.stop() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { model.talkOpen = false }
        }
    }

    private var phaseLabel: String {
        switch callHolder.call?.phase ?? .connecting {
        case .connecting: return "Connecting"
        case .listening: return "Listening"
        case .speaking: return "Speaking"
        case .thinking: return "Thinking"
        case .reconnecting: return "Reconnecting"
        case .ended: return "Ended"
        case .failed: return "Connection failed"
        }
    }

    private func boot() async {
        guard !ready else { return }
        ready = true
        struct Empty: Encodable {}
        let conversation: LiveConversation = (try? await model.api.get("assistant/live/conversation"))
            ?? LiveConversation(id: "", personalityId: "puck", messages: [])
        guard !conversation.id.isEmpty else { return }
        let people: [PersonalityOption] = (try? await model.api.get("assistant/personalities")) ?? []
        let call = LiveCall(api: model.api, conversationId: conversation.id)
        call.lines = conversation.messages
        call.accentHex = model.accentHex
        call.onTasksChanged = { model.boardRevision += 1 }
        call.personalityName = people.first { $0.id == conversation.personalityId }?.name ?? "Puck"
        callHolder.call = call
        call.start()
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
