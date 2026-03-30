import ExpoModulesCore
import AVFoundation
import Accelerate

// ─── Event payload ────────────────────────────────────────────────────────────

struct SoundEventRecord: Record {
  @Field var type: String        // "quiet" | "snoring" | "talking" | "loud_event"
  @Field var db: Double          // mean dBFS this epoch
  @Field var peakDb: Double      // peak dBFS this epoch
  @Field var timestamp: Double   // ms since epoch (JS-compatible)
}

// ─── Module ──────────────────────────────────────────────────────────────────

public class SleepAudioEngineModule: Module {

  // ── dB thresholds (dBFS — negative; 0 = max loudness) ─────────────────────
  private let DB_SNORING:     Float = -35
  private let DB_TALKING:     Float = -20
  private let DB_LOUD_EVENT:  Float = -8

  // ── Buffer config ──────────────────────────────────────────────────────────
  private let BUFFER_SIZE:    AVAudioFrameCount = 4096  // larger = less CPU
  private let EPOCH_SECS:     TimeInterval      = 30    // classify every 30s

  // ── State ──────────────────────────────────────────────────────────────────
  private var engine:        AVAudioEngine?
  private var rmsBuffer:     [Float] = []
  private var epochTimer:    Timer?
  private var isRunning      = false

  // ── Expo module definition ─────────────────────────────────────────────────
  public func definition() -> ModuleDefinition {
    Name("SleepAudioEngine")

    Events("onSoundEvent")

    // Returns whether mic permission is granted (uses modern API on iOS 17+)
    AsyncFunction("requestPermission") { (promise: Promise) in
      if #available(iOS 17.0, *) {
        AVAudioApplication.requestRecordPermission { granted in
          promise.resolve(granted)
        }
      } else {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
          promise.resolve(granted)
        }
      }
    }

    // Returns current permission status without requesting: "granted" | "denied" | "undetermined"
    Function("permissionStatus") { () -> String in
      if #available(iOS 17.0, *) {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:      return "granted"
        case .denied:       return "denied"
        default:            return "undetermined"
        }
      } else {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:      return "granted"
        case .denied:       return "denied"
        default:            return "undetermined"
        }
      }
    }

    AsyncFunction("start") { (promise: Promise) in
      guard !self.isRunning else { promise.resolve(true); return }

      let session = AVAudioSession.sharedInstance()
      do {
        // .measurement = minimal processing, ideal for analysis
        try session.setCategory(
          .playAndRecord,
          mode: .measurement,
          options: [.mixWithOthers, .allowBluetooth]
        )
        try session.setActive(true)
      } catch {
        promise.reject("AUDIO_SESSION_ERROR", error.localizedDescription)
        return
      }

      let eng = AVAudioEngine()
      let input  = eng.inputNode
      let format = input.outputFormat(forBus: 0)

      input.installTap(onBus: 0, bufferSize: self.BUFFER_SIZE, format: format) { [weak self] buffer, _ in
        self?.processBuffer(buffer)
      }

      do {
        try eng.start()
      } catch {
        promise.reject("ENGINE_START_ERROR", error.localizedDescription)
        return
      }

      self.engine   = eng
      self.isRunning = true
      self.rmsBuffer = []

      // Classify accumulated RMS values every EPOCH_SECS
      DispatchQueue.main.async {
        self.epochTimer = Timer.scheduledTimer(
          withTimeInterval: self.EPOCH_SECS,
          repeats: true
        ) { [weak self] _ in
          self?.classifyAndEmit()
        }
      }

      promise.resolve(true)
    }

    AsyncFunction("stop") { (promise: Promise) in
      self.stopEngine()
      promise.resolve(true)
    }

    Function("isRunning") {
      return self.isRunning
    }
  }

  // ── Audio processing ───────────────────────────────────────────────────────

  private func processBuffer(_ buffer: AVAudioPCMBuffer) {
    guard let data = buffer.floatChannelData?[0] else { return }
    let frameCount = Int(buffer.frameLength)
    guard frameCount > 0 else { return }

    // RMS of this buffer
    var rms: Float = 0
    vDSP_rmsqv(data, 1, &rms, vDSP_Length(frameCount))

    // Only store if non-trivial (avoids -inf in log)
    if rms > 1e-10 {
      rmsBuffer.append(rms)
    }
  }

  private func classifyAndEmit() {
    guard !rmsBuffer.isEmpty else {
      emit(type: "quiet", meanDb: -100, peakDb: -100)
      return
    }

    let snap = rmsBuffer
    rmsBuffer.removeAll()

    let mean = snap.reduce(0, +) / Float(snap.count)
    let peak = snap.max() ?? mean

    let meanDb = 20 * log10(mean)
    let peakDb = 20 * log10(peak)

    let type: String
    if peakDb > DB_LOUD_EVENT        { type = "loud_event" }
    else if meanDb > DB_TALKING      { type = "talking"    }
    else if meanDb > DB_SNORING      { type = "snoring"    }
    else                             { type = "quiet"      }

    emit(type: type, meanDb: meanDb, peakDb: peakDb)
  }

  private func emit(type: String, meanDb: Float, peakDb: Float) {
    sendEvent("onSoundEvent", [
      "type":      type,
      "db":        Double(meanDb.isNaN || meanDb.isInfinite ? -100 : meanDb),
      "peakDb":    Double(peakDb.isNaN || peakDb.isInfinite ? -100 : peakDb),
      "timestamp": Double(Date().timeIntervalSince1970 * 1000),
    ])
  }

  private func stopEngine() {
    epochTimer?.invalidate()
    epochTimer = nil

    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
    engine = nil
    isRunning = false
    rmsBuffer.removeAll()

    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  // Cleanup when module is deallocated
  deinit {
    stopEngine()
  }
}
