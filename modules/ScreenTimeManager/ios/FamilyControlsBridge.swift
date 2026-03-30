import Foundation
import FamilyControls
import ManagedSettings
import DeviceActivity
import SwiftUI

// Separate file so @available annotations are cleaner.
@available(iOS 16.0, *)
enum FamilyControlsBridge {
  private static let store = ManagedSettingsStore(named: ManagedSettingsStore.Name("coco.shields"))
  private static let authCenter = AuthorizationCenter.shared
  private static let appGroup = "group.com.breibart.coco"
  private static let selectionKey = "cocoSelectedApps"

  // MARK: - Auth

  static func requestAuth() async throws {
    try await authCenter.requestAuthorization(for: .individual)
  }

  static func authStatus() -> String {
    switch authCenter.authorizationStatus {
    case .approved: return "approved"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }

  // MARK: - App Picker

  /// Presents the FamilyActivityPicker and returns the number of items selected.
  @MainActor
  static func presentAppPicker() async -> Int {
    return await withCheckedContinuation { continuation in
      guard let windowScene = UIApplication.shared.connectedScenes
        .compactMap({ $0 as? UIWindowScene })
        .first(where: { $0.activationState == .foregroundActive }),
        let rootVC = windowScene.windows.first(where: { $0.isKeyWindow })?.rootViewController
      else {
        continuation.resume(returning: 0)
        return
      }

      // Find the topmost presented view controller
      var topVC = rootVC
      while let presented = topVC.presentedViewController {
        topVC = presented
      }

      let initialSelection = loadSelection() ?? FamilyActivitySelection()
      let model = SelectionModel(initialSelection)

      let sheet = AppPickerSheet(model: model) {
        // Done tapped — save and dismiss
        saveSelection(model.selection)
        let count = model.selection.applicationTokens.count + model.selection.categoryTokens.count
        topVC.dismiss(animated: true) {
          continuation.resume(returning: count)
        }
      } onCancel: {
        topVC.dismiss(animated: true) {
          let count = model.selection.applicationTokens.count + model.selection.categoryTokens.count
          continuation.resume(returning: count)
        }
      }

      let hostingVC = UIHostingController(rootView: sheet)
      topVC.present(hostingVC, animated: true)
    }
  }

  static func getSelectedAppsCount() -> Int {
    guard let selection = loadSelection() else { return 0 }
    return selection.applicationTokens.count + selection.categoryTokens.count
  }

  // MARK: - Block / Unblock

  static func startBlock() {
    if let selection = loadSelection(), !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty {
      // Block only user-selected apps
      if !selection.applicationTokens.isEmpty {
        store.shield.applications = selection.applicationTokens
      }
      if !selection.categoryTokens.isEmpty {
        store.shield.applicationCategories = .specific(selection.categoryTokens)
      }
    } else {
      // Fallback: block common social/entertainment categories if no selection made
      store.shield.applicationCategories = .all(except: [])
    }
  }

  static func stopBlock() {
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
  }

  // MARK: - Schedule (DeviceActivity — wakes CocoDeviceActivity extension at bedtime/wake)

  static let activityName = DeviceActivityName("coco.sleep")
  private static let activityCenter = DeviceActivityCenter()

  static func scheduleBlock(startHour: Int, startMinute: Int, endHour: Int, endMinute: Int) throws {
    // Always cancel first so re-scheduling doesn't throw an "already monitoring" error
    activityCenter.stopMonitoring([activityName])
    let schedule = DeviceActivitySchedule(
      intervalStart: DateComponents(hour: startHour, minute: startMinute),
      intervalEnd:   DateComponents(hour: endHour,   minute: endMinute),
      repeats: true
    )
    try activityCenter.startMonitoring(activityName, during: schedule)
  }

  static func cancelBlock() {
    activityCenter.stopMonitoring([activityName])
  }

  // MARK: - Persistence

  private static func saveSelection(_ selection: FamilyActivitySelection) {
    guard let data = try? PropertyListEncoder().encode(selection) else { return }
    let ud = UserDefaults(suiteName: appGroup)
    ud?.set(data, forKey: selectionKey)
    ud?.synchronize()
  }

  static func loadSelection() -> FamilyActivitySelection? {
    guard let data = UserDefaults(suiteName: appGroup)?.data(forKey: selectionKey) else { return nil }
    return try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
  }
}

// MARK: - SwiftUI picker sheet

@available(iOS 16.0, *)
class SelectionModel: ObservableObject {
  @Published var selection: FamilyActivitySelection
  init(_ initial: FamilyActivitySelection) { self.selection = initial }
}

@available(iOS 16.0, *)
struct AppPickerSheet: View {
  @ObservedObject var model: SelectionModel
  var onDone: () -> Void
  var onCancel: () -> Void

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $model.selection)
        .navigationTitle("Choose Apps to Block")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .navigationBarLeading) {
            Button("Cancel") { onCancel() }
          }
          ToolbarItem(placement: .navigationBarTrailing) {
            Button("Done") { onDone() }
              .fontWeight(.bold)
          }
        }
    }
  }
}
