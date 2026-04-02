import ExpoModulesCore
import AVFoundation
import Accelerate

// ─── Module ──────────────────────────────────────────────────────────────────
//
// Sound Classification Pipeline (every 30s epoch):
//
//   1. RMS amplitude  → dBFS mean + peak
//   2. FFT (4096-pt)  → spectral centroid (Hz)  — low=snoring, high=speech
//   3. ZCR            → zero-crossing rate       — slow=snoring, fast=speech
//   4. Periodicity    → per-second RMS rhythm    — rhythmic=snoring
//   5. Rule-based classify → quiet/snoring/talking/loud_event
//
// Clip capture: circular 8-second PCM buffer.
// On non-quiet detection: take last 5s + record 10s post-event → .caf file.
// Emits `onClipSaved` when clip is finalized.

public class SleepAudioEngineModule: Module {

  // ── dB thresholds (dBFS, negative) ────────────────────────────────────────
  private let DB_FLOOR:      Float = -42   // below = quiet, no clip
  private let DB_SNORING:    Float = -35   // sustained snoring level
  private let DB_TALKING:    Float = -20   // speech is louder
  private let DB_LOUD_EVENT: Float = -8    // sudden peak burst

  // ── Spectral / ZCR thresholds ─────────────────────────────────────────────
  // Snoring fundamental: 80–400 Hz, harmonics to ~2 kHz → centroid < 800 Hz
  // Speech formants:     300–4000 Hz                    → centroid > 600 Hz
  private let CENTROID_SNORE_MAX: Float = 800   // Hz — centroid below this = snoring-like
  private let CENTROID_SPEECH_MIN: Float = 600  // Hz — centroid above this = speech-like
  private let ZCR_SNORE_MAX:  Float = 0.08      // snoring is a slow low-freq oscillation
  private let ZCR_SPEECH_MIN: Float = 0.05      // speech has more sign changes

  // ── Engine / tap config ───────────────────────────────────────────────────
  private let BUFFER_SIZE: AVAudioFrameCount = 4096
  private let EPOCH_SECS:  TimeInterval      = 30

  // ── Clip config ────────────────────────────────────────────────────────────
  private let PRE_CLIP_SECS:   Double = 5
  private let POST_CLIP_SECS:  Double = 10
  private let CIRCULAR_SECS:   Double = 8

  // ── FFT setup ─────────────────────────────────────────────────────────────
  private let FFT_SIZE  = 4096     // must be power of 2
  private let FFT_LOG2N = vDSP_Length(12)   // log2(4096) = 12
  private var fftSetup: FFTSetup? = nil

  // ── Engine state ───────────────────────────────────────────────────────────
  private var engine:          AVAudioEngine?
  private var epochTimer:      Timer?
  private var isRunning        = false
  private var inputSampleRate: Double      = 44100
  private var inputFormat:     AVAudioFormat? = nil

  // ── Per-epoch analysis buffers (audio thread writes, main thread reads) ────
  private var rmsBuffer: [Float] = []  // one RMS value per 4096-frame buffer

  // ── Circular PCM buffer (audio thread; protected by clipLock) ─────────────
  private var circularChunks:      [[Float]] = []
  private var circularTotalFrames: Int       = 0
  private var circularMaxFrames:   Int       = 0

  // ── Clip writing ──────────────────────────────────────────────────────────
  private var clipFile:               AVAudioFile? = nil
  private var clipPostFramesLeft:     Int          = 0
  private var clipPath:               String       = ""
  private var clipTriggerTimestamp:   Double       = 0
  private var clipTriggerType:        String       = ""
  private var clipTotalFramesWritten: Int          = 0
  private let clipLock       = NSLock()
  private let clipWriteQueue = DispatchQueue(label: "sleep.clip.write", qos: .background)

  // ── Module definition ─────────────────────────────────────────────────────
  public func definition() -> ModuleDefinition {
    Name("SleepAudioEngine")
    Events("onSoundEvent", "onClipSaved")

    AsyncFunction("requestPermission") { (promise: Promise) in
      if #available(iOS 17.0, *) {
        AVAudioApplication.requestRecordPermission { promise.resolve($0) }
      } else {
        AVAudioSession.sharedInstance().requestRecordPermission { promise.resolve($0) }
      }
    }

    Function("permissionStatus") { () -> String in
      if #available(iOS 17.0, *) {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return "granted"
        case .denied:  return "denied"
        default:       return "undetermined"
        }
      } else {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return "granted"
        case .denied:  return "denied"
        default:       return "undetermined"
        }
      }
    }

    AsyncFunction("start") { (promise: Promise) in
      guard !self.isRunning else { promise.resolve(true); return }
      self.startEngineWithRetry(attempt: 0, promise: promise)
    }

    AsyncFunction("stop") { (promise: Promise) in
      self.stopEngine()
      promise.resolve(true)
    }

    Function("isRunning") { return self.isRunning }
  }

  // ── Engine start ──────────────────────────────────────────────────────────

  private func startEngineWithRetry(attempt: Int, promise: Promise) {
    let session = AVAudioSession.sharedInstance()
    do {
      try? session.setActive(false, options: .notifyOthersOnDeactivation)
      try session.setCategory(.playAndRecord, mode: .measurement,
                              options: [.mixWithOthers, .allowBluetooth, .defaultToSpeaker])
      try session.setActive(true)
    } catch {
      promise.reject("AUDIO_SESSION_ERROR", error.localizedDescription); return
    }

    let eng    = AVAudioEngine()
    let input  = eng.inputNode
    let format = input.outputFormat(forBus: 0)
    inputSampleRate   = format.sampleRate
    inputFormat       = format
    circularMaxFrames = Int(inputSampleRate * CIRCULAR_SECS)
    circularChunks    = []
    circularTotalFrames = 0
    rmsBuffer         = []

    // Create FFT setup (only once)
    if fftSetup == nil {
      fftSetup = vDSP_create_fftsetup(FFT_LOG2N, FFTRadix(kFFTRadix2))
    }

    ensureClipsDir()

    input.installTap(onBus: 0, bufferSize: BUFFER_SIZE, format: format) { [weak self] buf, _ in
      self?.processBuffer(buf)
    }

    do { try eng.start() } catch {
      if attempt < 1 {
        input.removeTap(onBus: 0)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
          self.startEngineWithRetry(attempt: attempt + 1, promise: promise)
        }
        return
      }
      promise.reject("ENGINE_START_ERROR", error.localizedDescription); return
    }

    engine    = eng
    isRunning = true

    DispatchQueue.main.async {
      self.epochTimer = Timer.scheduledTimer(withTimeInterval: self.EPOCH_SECS, repeats: true) { [weak self] _ in
        self?.classifyAndEmit()
      }
    }
    promise.resolve(true)
  }

  // ── Audio tap (real-time thread) ──────────────────────────────────────────

  private func processBuffer(_ buffer: AVAudioPCMBuffer) {
    guard let data = buffer.floatChannelData?[0] else { return }
    let frameCount = Int(buffer.frameLength)
    guard frameCount > 0 else { return }

    // Per-epoch RMS (for amplitude classification)
    var rms: Float = 0
    vDSP_rmsqv(data, 1, &rms, vDSP_Length(frameCount))
    if rms > 1e-10 { rmsBuffer.append(rms) }

    // Mono samples for circular buffer + FFT
    let samples = Array(UnsafeBufferPointer(start: data, count: frameCount))

    clipLock.lock()

    // Update circular buffer
    circularChunks.append(samples)
    circularTotalFrames += frameCount
    while circularTotalFrames > circularMaxFrames, let first = circularChunks.first {
      circularTotalFrames -= first.count
      circularChunks.removeFirst()
    }

    // Write to clip file if active
    if clipPostFramesLeft > 0, let file = clipFile {
      let writeCount          = min(frameCount, clipPostFramesLeft)
      clipPostFramesLeft     -= writeCount
      clipTotalFramesWritten += writeCount
      let writeData           = Array(samples.prefix(writeCount))
      let shouldFinalize      = clipPostFramesLeft <= 0
      let pathSnap            = clipPath
      let tsSnap              = clipTriggerTimestamp
      let typeSnap            = clipTriggerType
      let totalSnap           = clipTotalFramesWritten
      let srSnap              = inputSampleRate
      clipLock.unlock()

      clipWriteQueue.async {
        self.writeSamples(writeData, toFile: file)
        if shouldFinalize {
          self.finalizeClip(file: file, path: pathSnap, timestamp: tsSnap,
                            type: typeSnap, totalFrames: totalSnap, sampleRate: srSnap)
        }
      }
      return
    }
    clipLock.unlock()
  }

  // ── Epoch classification (main thread, every 30s) ─────────────────────────

  private func classifyAndEmit() {
    guard !rmsBuffer.isEmpty else {
      emitSound(type: "quiet", meanDb: -100, peakDb: -100); return
    }

    let snap = rmsBuffer; rmsBuffer.removeAll()
    let mean = snap.reduce(0, +) / Float(snap.count)
    let peak = snap.max() ?? mean
    let meanDb = 20 * log10(mean)
    let peakDb = 20 * log10(peak)

    // Snapshot recent PCM samples for spectral analysis
    clipLock.lock()
    var recentSamples: [Float] = []
    for chunk in circularChunks.suffix(12) {   // ~1.1s at 44100 Hz
      recentSamples.append(contentsOf: chunk)
    }
    clipLock.unlock()

    // Per-second RMS → periodicity (group rmsBuffer buckets by ~sampleRate/BUFFER_SIZE)
    let buffersPerSec = max(1, Int(inputSampleRate / Double(BUFFER_SIZE)))
    var perSecRMS: [Float] = []
    var i = 0
    while i < snap.count {
      let end   = min(i + buffersPerSec, snap.count)
      let slice = snap[i..<end]
      perSecRMS.append(slice.reduce(0, +) / Float(slice.count))
      i += buffersPerSec
    }

    // Compute features
    let (centroid, zcr)  = computeSpectralFeatures(samples: recentSamples)
    let rhythmic         = detectPeriodicity(perSecRMS: perSecRMS)

    let type = classifySound(meanDb: meanDb, peakDb: peakDb,
                             centroid: centroid, zcr: zcr, rhythmic: rhythmic)

    // Trigger clip on non-quiet
    if type != "quiet" {
      clipLock.lock()
      let alreadyRecording = clipPostFramesLeft > 0
      clipLock.unlock()
      if !alreadyRecording { startClipCapture(eventType: type, timestamp: Double(Date().timeIntervalSince1970 * 1000)) }
    }

    emitSound(type: type, meanDb: meanDb, peakDb: peakDb)
  }

  // ── Sound classification ──────────────────────────────────────────────────

  private func classifySound(meanDb: Float, peakDb: Float,
                              centroid: Float, zcr: Float, rhythmic: Bool) -> String {
    // Sudden loud burst: peak stands far above mean → cough, snort, door
    if peakDb > DB_LOUD_EVENT { return "loud_event" }

    // Below noise floor
    guard meanDb > DB_FLOOR else { return "quiet" }

    // Snoring: low-frequency (centroid < 800 Hz) + slow oscillation (ZCR < 0.08)
    // Also accept rhythmic breathing patterns even if centroid is mid-range
    let lowFreq = centroid < CENTROID_SNORE_MAX
    let slowOsc = zcr < ZCR_SNORE_MAX
    if lowFreq && slowOsc && meanDb > DB_SNORING { return "snoring" }

    // Rhythmic pattern even at louder level → snoring (mouth breathing / snort rhythm)
    if rhythmic && meanDb > DB_SNORING && centroid < 1200 { return "snoring" }

    // Speech: higher centroid + faster ZCR + above talking threshold
    let midHighFreq = centroid > CENTROID_SPEECH_MIN
    let fasterZCR   = zcr > ZCR_SPEECH_MIN
    if midHighFreq && fasterZCR && meanDb > DB_TALKING { return "talking" }

    // Elevated volume but ambiguous spectrum → default to snoring
    // (sleep sounds are far more commonly snoring than talking)
    if meanDb > DB_SNORING { return "snoring" }

    return "quiet"
  }

  private func emitSound(type: String, meanDb: Float, peakDb: Float) {
    sendEvent("onSoundEvent", [
      "type":      type,
      "db":        Double(meanDb.isNaN || meanDb.isInfinite ? -100 : meanDb),
      "peakDb":    Double(peakDb.isNaN || peakDb.isInfinite ? -100 : peakDb),
      "timestamp": Double(Date().timeIntervalSince1970 * 1000),
    ])
  }

  // ── Spectral analysis ─────────────────────────────────────────────────────

  /// Returns (spectralCentroid in Hz, zeroCrossingRate per sample).
  private func computeSpectralFeatures(samples: [Float]) -> (centroid: Float, zcr: Float) {
    let n = FFT_SIZE
    guard samples.count >= n, let setup = fftSetup else {
      return (1000, 0.1)  // neutral defaults → won't bias classification
    }

    // Take last n samples
    let window = Array(samples.suffix(n))

    // 1. Apply Hann window to reduce spectral leakage
    var hannWin = [Float](repeating: 0, count: n)
    vDSP_hann_window(&hannWin, vDSP_Length(n), Int32(vDSP_HANN_NORM))
    var windowed = [Float](repeating: 0, count: n)
    vDSP_vmul(window, 1, hannWin, 1, &windowed, 1, vDSP_Length(n))

    // 2. Pack as split-complex: even samples → real, odd samples → imag
    //    This is the required packing for vDSP_fft_zrip.
    var realPart = (0..<n/2).map { windowed[$0 * 2]     }
    var imagPart = (0..<n/2).map { windowed[$0 * 2 + 1] }

    // 3. Real FFT via vDSP_fft_zrip
    var magnitudes = [Float](repeating: 0, count: n/2)
    realPart.withUnsafeMutableBufferPointer { rp in
      imagPart.withUnsafeMutableBufferPointer { ip in
        var sc = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
        vDSP_fft_zrip(setup, &sc, 1, FFT_LOG2N, FFTDirection(kFFTDirection_Forward))
        magnitudes.withUnsafeMutableBufferPointer { mp in
          vDSP_zvmags(&sc, 1, mp.baseAddress!, 1, vDSP_Length(n/2))
        }
      }
    }

    // 4. Spectral centroid: Σ(freq[i] * mag[i]) / Σ(mag[i])
    //    Skip bin 0 (DC) to avoid DC offset biasing the centroid.
    let binHz = Float(inputSampleRate) / Float(n)
    var wSum: Float = 0
    var tMag: Float = 0
    for bin in 1..<n/2 {
      wSum += Float(bin) * binHz * magnitudes[bin]
      tMag += magnitudes[bin]
    }
    let centroid = tMag > 1e-10 ? wSum / tMag : 0

    // 5. Zero crossing rate: fraction of samples where sign changes
    var crossings: Float = 0
    for k in 1..<n {
      if (window[k] >= 0) != (window[k-1] >= 0) { crossings += 1 }
    }
    let zcr = crossings / Float(n)

    return (centroid, zcr)
  }

  // ── Periodicity detection (snoring rhythm) ────────────────────────────────

  /// Returns true if per-second RMS shows a regular rhythm (2–6 second period).
  /// Snoring typically repeats every 2–5 seconds; speech is irregular.
  private func detectPeriodicity(perSecRMS: [Float]) -> Bool {
    guard perSecRMS.count >= 8 else { return false }

    let mean = perSecRMS.reduce(0, +) / Float(perSecRMS.count)
    guard mean > 1e-6 else { return false }

    let threshold = mean * 1.25

    // Find local peaks above threshold
    var peaks: [Int] = []
    for k in 1..<perSecRMS.count - 1 {
      if perSecRMS[k] > threshold &&
         perSecRMS[k] >= perSecRMS[k-1] &&
         perSecRMS[k] >= perSecRMS[k+1] {
        peaks.append(k)
      }
    }
    guard peaks.count >= 3 else { return false }

    // Inter-peak intervals (in seconds, since each element = 1 second)
    let intervals = zip(peaks.dropFirst(), peaks).map { Float($0 - $1) }
    let avgInterval = intervals.reduce(0, +) / Float(intervals.count)

    // Snoring cadence: roughly 2–6 seconds between peaks
    guard avgInterval >= 2.0 && avgInterval <= 6.0 else { return false }

    // Coefficient of variation: low CV = regular rhythm
    let variance = intervals.map { ($0 - avgInterval) * ($0 - avgInterval) }
      .reduce(0, +) / Float(intervals.count)
    let cv = sqrt(variance) / avgInterval

    return cv < 0.55  // <55% variation = consistent enough to be snoring
  }

  // ── Clip capture ──────────────────────────────────────────────────────────

  private func startClipCapture(eventType: String, timestamp: Double) {
    guard let fmt = inputFormat else { return }
    let ts  = Int(timestamp)
    let url = clipsDir().appendingPathComponent("clip_\(ts).caf")

    let settings: [String: Any] = [
      AVFormatIDKey:             kAudioFormatLinearPCM,
      AVSampleRateKey:           fmt.sampleRate,
      AVNumberOfChannelsKey:     1,
      AVLinearPCMBitDepthKey:    16,
      AVLinearPCMIsFloatKey:     false,
      AVLinearPCMIsBigEndianKey: false,
    ]
    guard let file = try? AVAudioFile(forWriting: url, settings: settings) else { return }

    // Pre-event audio from circular buffer
    clipLock.lock()
    let preTarget = Int(fmt.sampleRate * PRE_CLIP_SECS)
    var preSamples: [Float] = []
    for chunk in circularChunks.reversed() {
      preSamples = chunk + preSamples
      if preSamples.count >= preTarget { break }
    }
    if preSamples.count > preTarget { preSamples = Array(preSamples.suffix(preTarget)) }

    clipFile               = file
    clipPostFramesLeft     = Int(fmt.sampleRate * POST_CLIP_SECS)
    clipPath               = url.path
    clipTriggerTimestamp   = timestamp
    clipTriggerType        = eventType
    clipTotalFramesWritten = preSamples.count
    clipLock.unlock()

    let fileRef = file
    let pre     = preSamples
    clipWriteQueue.async { self.writeSamples(pre, toFile: fileRef) }
  }

  // ── File I/O ──────────────────────────────────────────────────────────────

  private func writeSamples(_ samples: [Float], toFile file: AVAudioFile) {
    guard !samples.isEmpty else { return }
    let fmt      = file.processingFormat
    let capacity = AVAudioFrameCount(samples.count)
    guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: capacity) else { return }
    buf.frameLength = capacity
    if let ch = buf.floatChannelData?[0] {
      samples.withUnsafeBufferPointer { ptr in
        ch.assign(from: ptr.baseAddress!, count: samples.count)
      }
    }
    try? file.write(from: buf)
  }

  private func finalizeClip(file: AVAudioFile, path: String,
                             timestamp: Double, type: String,
                             totalFrames: Int, sampleRate: Double) {
    let duration = sampleRate > 0 ? Double(totalFrames) / sampleRate : 0
    clipLock.lock()
    if clipPath == path { clipFile = nil }
    clipLock.unlock()
    DispatchQueue.main.async {
      self.sendEvent("onClipSaved", [
        "path": path, "timestamp": timestamp, "type": type, "duration": duration,
      ])
    }
  }

  private func clipsDir() -> URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
      .appendingPathComponent("sleep_clips")
  }

  private func ensureClipsDir() {
    try? FileManager.default.createDirectory(at: clipsDir(), withIntermediateDirectories: true)
  }

  // ── Engine stop ───────────────────────────────────────────────────────────

  private func stopEngine() {
    epochTimer?.invalidate(); epochTimer = nil
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop(); engine = nil
    isRunning = false
    rmsBuffer.removeAll()
    circularChunks.removeAll()
    circularTotalFrames = 0

    clipLock.lock()
    clipFile = nil; clipPostFramesLeft = 0
    clipLock.unlock()

    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  deinit {
    stopEngine()
    if let s = fftSetup { vDSP_destroy_fftsetup(s) }
  }
}
