import AVFoundation
import WebRTC

/// Captures the mic immediately and keeps the samples. WebRTC is fed silence
/// until `forward()` so speech during connect is sent once the line is up.
final class HeldMic: NSObject, RTCAudioDevice {
    var onLevel: ((Double) -> Void)?

    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var delegate: RTCAudioDeviceDelegate?
    private var source: AVAudioSourceNode?
    private var playBuffer = [Int16](repeating: 0, count: 4096)
    private var ring = [Int16](repeating: 0, count: 48000 * 10)
    private var readIndex = 0
    private var writeIndex = 0
    private var stored = 0
    private var sampleRate: Double = 48000
    private var sampleTime: Double = 0
    private var lastLevelAt = Date.distantPast
    private var started = false
    private var pulling = false
    private var playing = false
    private var forwarding = false

    func start() {
        if started {
            reactivate()
            return
        }
        configureSession()
        let input = engine.inputNode
        try? input.setVoiceProcessingEnabled(true)
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { return }
        sampleRate = format.sampleRate
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.onInput(buffer)
        }
        let playFormat = AVAudioFormat(standardFormatWithSampleRate: format.sampleRate, channels: 1)!
        let node = AVAudioSourceNode(format: playFormat) { [weak self] _, timestamp, frameCount, output in
            self?.renderPlay(timestamp: timestamp, frameCount: frameCount, output: output) ?? noErr
        }
        source = node
        let mute = AVAudioMixerNode()
        mute.outputVolume = 0
        engine.attach(node)
        engine.attach(mute)
        engine.connect(node, to: engine.mainMixerNode, format: playFormat)
        engine.connect(input, to: mute, format: format)
        engine.connect(mute, to: engine.mainMixerNode, format: format)
        engine.prepare()
        do {
            try engine.start()
            started = true
        } catch {
            input.removeTap(onBus: 0)
        }
    }

    func stop() {
        guard started else { return }
        started = false
        pulling = false
        playing = false
        forwarding = false
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        lock.lock()
        stored = 0
        readIndex = 0
        writeIndex = 0
        lock.unlock()
    }

    /// New attempt. Keep what was already captured.
    func hold() {
        lock.lock()
        forwarding = false
        lock.unlock()
    }

    /// The line can take audio. Speech already captured goes out first.
    func forward() {
        lock.lock()
        forwarding = true
        lock.unlock()
    }

    func reactivate() {
        configureSession()
        if started, !engine.isRunning {
            try? engine.start()
        }
    }

    private func configureSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try? session.setPreferredSampleRate(48000)
        try? session.setPreferredIOBufferDuration(0.02)
        try? session.setActive(true)
    }

    private func onInput(_ buffer: AVAudioPCMBuffer) {
        guard let channels = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        guard frames > 0, channelCount > 0 else { return }
        var pcm = [Int16](repeating: 0, count: frames)
        var energy: Float = 0
        for index in 0..<frames {
            var sample: Float = 0
            for channel in 0..<channelCount {
                sample += channels[channel][index]
            }
            sample /= Float(channelCount)
            energy += sample * sample
            pcm[index] = Int16(max(-1, min(1, sample)) * 32767)
        }
        let level = sqrt(energy / Float(frames))
        lock.lock()
        for sample in pcm {
            ring[writeIndex] = sample
            writeIndex = (writeIndex + 1) % ring.count
            if stored == ring.count {
                readIndex = (readIndex + 1) % ring.count
            } else {
                stored += 1
            }
        }
        let shouldPull = pulling
        let live = forwarding
        let chunk: [Int16]? = live ? takeChunk(frames) : nil
        lock.unlock()
        publish(level)
        if shouldPull {
            deliver(chunk ?? [Int16](repeating: 0, count: frames))
        }
    }

    /// Drops quiet audio once more than 0.4s is waiting, so a pause catches the call up.
    private func takeChunk(_ frames: Int) -> [Int16] {
        let slack = Int(sampleRate * 0.4)
        let probe = max(1, Int(sampleRate * 0.02))
        while stored > slack {
            let look = min(probe, stored)
            if !quiet(look) { break }
            drop(look)
        }
        var out = [Int16](repeating: 0, count: frames)
        let count = min(frames, stored)
        for index in 0..<count {
            out[index] = ring[readIndex]
            readIndex = (readIndex + 1) % ring.count
            stored -= 1
        }
        return out
    }

    private func quiet(_ count: Int) -> Bool {
        var total = 0
        var index = readIndex
        for _ in 0..<count {
            total += Int(abs(Int32(ring[index])))
            index = (index + 1) % ring.count
        }
        return total / count < 500
    }

    private func drop(_ count: Int) {
        let amount = min(count, stored)
        readIndex = (readIndex + amount) % ring.count
        stored -= amount
    }

    private func publish(_ level: Float) {
        let now = Date()
        guard now.timeIntervalSince(lastLevelAt) > 0.08 else { return }
        lastLevelAt = now
        let value = min(1, Double(level) * 8)
        DispatchQueue.main.async { [weak self] in self?.onLevel?(value) }
    }

    private func deliver(_ samples: [Int16]) {
        guard let delegate else { return }
        var flags: AudioUnitRenderActionFlags = []
        var timestamp = AudioTimeStamp()
        timestamp.mFlags = .sampleTimeValid
        timestamp.mSampleTime = sampleTime
        sampleTime += Double(samples.count)
        _ = delegate.deliverRecordedData(&flags, &timestamp, 0, UInt32(samples.count), nil, nil) { _, _, _, _, list, _ in
            let buffers = UnsafeMutableAudioBufferListPointer(list)
            for buffer in buffers {
                guard let data = buffer.mData else { continue }
                let capacity = Int(buffer.mDataByteSize) / MemoryLayout<Int16>.size
                let count = min(capacity, samples.count)
                let dest = data.bindMemory(to: Int16.self, capacity: count)
                for index in 0..<count { dest[index] = samples[index] }
            }
            return noErr
        }
    }

    private func renderPlay(
        timestamp: UnsafePointer<AudioTimeStamp>,
        frameCount: AVAudioFrameCount,
        output: UnsafeMutablePointer<AudioBufferList>
    ) -> OSStatus {
        let frames = Int(frameCount)
        let buffers = UnsafeMutableAudioBufferListPointer(output)
        guard playing, let delegate, frames > 0, frames <= playBuffer.count else {
            for buffer in buffers {
                if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
            }
            return noErr
        }
        playBuffer.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return }
            var list = AudioBufferList(
                mNumberBuffers: 1,
                mBuffers: AudioBuffer(
                    mNumberChannels: 1,
                    mDataByteSize: UInt32(frames * MemoryLayout<Int16>.size),
                    mData: base
                )
            )
            var flags: AudioUnitRenderActionFlags = []
            var time = timestamp.pointee
            _ = delegate.getPlayoutData(&flags, &time, 0, frameCount, &list)
        }
        let rendered = playBuffer
        for buffer in buffers {
            guard let data = buffer.mData else { continue }
            let dest = data.bindMemory(to: Float.self, capacity: frames)
            for index in 0..<frames {
                dest[index] = Float(rendered[index]) / 32768
            }
        }
        return noErr
    }

    var deviceInputSampleRate: Double { sampleRate }
    var inputIOBufferDuration: TimeInterval { 1024 / sampleRate }
    var inputNumberOfChannels: Int { 1 }
    var inputLatency: TimeInterval { AVAudioSession.sharedInstance().inputLatency }
    var deviceOutputSampleRate: Double { sampleRate }
    var outputIOBufferDuration: TimeInterval { 1024 / sampleRate }
    var outputNumberOfChannels: Int { 1 }
    var outputLatency: TimeInterval { AVAudioSession.sharedInstance().outputLatency }
    var isInitialized: Bool { delegate != nil }
    var isPlayoutInitialized: Bool { source != nil }
    var isPlaying: Bool { playing }
    var isRecordingInitialized: Bool { started }
    var isRecording: Bool { pulling }

    func initialize(with delegate: RTCAudioDeviceDelegate) -> Bool {
        self.delegate = delegate
        start()
        delegate.dispatchAsync { [weak self] in
            guard let self, let delegate = self.delegate else { return }
            delegate.notifyAudioInputParametersChange()
            delegate.notifyAudioOutputParametersChange()
        }
        return started
    }

    func terminateDevice() -> Bool {
        delegate = nil
        pulling = false
        playing = false
        return true
    }

    func initializePlayout() -> Bool { source != nil }
    func startPlayout() -> Bool {
        playing = true
        return true
    }
    func stopPlayout() -> Bool {
        playing = false
        return true
    }
    func initializeRecording() -> Bool { started }
    func startRecording() -> Bool {
        pulling = true
        return true
    }
    func stopRecording() -> Bool {
        pulling = false
        return true
    }
}
