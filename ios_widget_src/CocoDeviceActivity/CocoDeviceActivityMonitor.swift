import DeviceActivity
import ManagedSettings
import FamilyControls
import Foundation

// This extension is woken by iOS at the user's bedtime and wake time.
// It applies / removes app shields using the selection saved in the shared App Group.

@available(iOS 16.0, *)
class CocoDeviceActivityMonitor: DeviceActivityMonitor {
  private static let appGroup    = "group.com.breibart.coco"
  private static let selectionKey = "cocoSelectedApps"
  private let store = ManagedSettingsStore()

  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    applyShields()
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    removeShields()
  }

  private func applyShields() {
    guard
      let data = UserDefaults(suiteName: Self.appGroup)?.data(forKey: Self.selectionKey),
      let selection = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data),
      !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty
    else {
      // No specific selection saved — block all social/entertainment as a safe default
      store.shield.applicationCategories = .all(except: [])
      return
    }
    if !selection.applicationTokens.isEmpty {
      store.shield.applications = selection.applicationTokens
    }
    if !selection.categoryTokens.isEmpty {
      store.shield.applicationCategories = .specific(selection.categoryTokens)
    }
  }

  private func removeShields() {
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
  }
}
