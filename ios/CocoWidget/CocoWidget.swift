import WidgetKit
import SwiftUI

// MARK: - Data model read from App Group UserDefaults
private let appGroup = "group.com.breibart.coco"

struct CocoEntry: TimelineEntry {
    let date: Date
    let recoveryScore: Int
    let streak: Int
    let tierName: String
    let isTracking: Bool
    let cocoLevel: String  // "bad" | "normal" | "leather" | "gold" | "diamond"
    let cocoLevelNum: Int  // numeric level from store (1, 2, 3 …)
    let growthImageName: String  // exact asset name e.g. "growth_mature_1"
}

// react-native-shared-group-preferences stores values as JSON strings
private func readDefaults() -> CocoEntry {
    let ud = UserDefaults(suiteName: appGroup)

    func intVal(_ key: String) -> Int {
        if let str = ud?.string(forKey: key), let v = Int(str) { return v }
        if let n = ud?.object(forKey: key) as? NSNumber { return n.intValue }
        return 0
    }
    func strVal(_ key: String) -> String {
        ud?.string(forKey: key) ?? ""
    }

    let levelNum = intVal("cocoLevelNum")
    let streak = intVal("streak")
    // Use the exact image name written by the JS side; fall back to streak-based calculation
    let savedImageName = strVal("growthImageName")
    let resolvedImageName: String
    if savedImageName.isEmpty {
        // Fallback: compute from streak (sub-image _1 is safest default)
        if streak >= 21 { resolvedImageName = "growth_legendary_1" }
        else if streak >= 11 { resolvedImageName = "growth_mature_1" }
        else if streak >= 6  { resolvedImageName = "growth_growing_1" }
        else if streak >= 3  { resolvedImageName = "growth_baby_1" }
        else { resolvedImageName = "growth_seed_1" }
    } else {
        resolvedImageName = savedImageName
    }
    return CocoEntry(
        date: Date(),
        recoveryScore: intVal("recoveryScore"),
        streak: streak,
        tierName: strVal("tierName"),
        isTracking: intVal("isTracking") == 1,
        cocoLevel: strVal("cocoLevel").isEmpty ? "normal" : strVal("cocoLevel"),
        cocoLevelNum: levelNum > 0 ? levelNum : 1,
        growthImageName: resolvedImageName
    )
}

// Streak color: white at 0 days, fully gold (#F5C842) at 14+ days
// So at 4 days: noticeably warm/golden already
private func streakColor(_ streak: Int) -> Color {
    let t = min(Double(streak) / 14.0, 1.0)
    return Color(
        red:   1.0,
        green: 1.0 - 0.22 * t,   // 1.0 → 0.78
        blue:  1.0 - 0.74 * t    // 1.0 → 0.26
    )
}

// MARK: - Provider
struct CocoProvider: TimelineProvider {
    func placeholder(in context: Context) -> CocoEntry {
        CocoEntry(date: Date(), recoveryScore: 82, streak: 11, tierName: "Coconut", isTracking: false, cocoLevel: "gold", cocoLevelNum: 2, growthImageName: "growth_mature_1")
    }

    func getSnapshot(in context: Context, completion: @escaping (CocoEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : readDefaults())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CocoEntry>) -> Void) {
        let entry = readDefaults()
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Score color
private func scoreColor(_ score: Int) -> Color {
    if score >= 75 { return Color(red: 0.24, green: 0.86, blue: 0.52) }  // green
    if score >= 50 { return Color(red: 0.96, green: 0.78, blue: 0.26) }  // gold
    return Color(red: 1.0, green: 0.18, blue: 0.18)                       // red
}

private let cocoWidgetBg = Color(red: 0.05, green: 0.05, blue: 0.05)
private let cocoRed      = Color(red: 1.0, green: 0.18, blue: 0.18)

// MARK: - Small widget
struct CocoSmallView: View {
    let entry: CocoEntry

    var body: some View {
        ZStack(alignment: .leading) {
            cocoWidgetBg

            HStack(spacing: 0) {
                Rectangle().fill(cocoRed).frame(width: 4)
                Spacer()
            }

            VStack(alignment: .leading, spacing: 6) {
                if entry.isTracking {
                    Text("// COCO RECOVERY")
                        .font(.system(size: 9, weight: .black))
                        .italic()
                        .foregroundColor(cocoRed)
                        .tracking(2)
                    Spacer()
                    Link(destination: URL(string: "coco-sleep://begin-sleep")!) {
                        Text("WAKE UP →")
                            .font(.system(size: 12, weight: .black))
                            .italic()
                            .foregroundColor(.white)
                            .tracking(1)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(cocoRed)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } else {
                    Text("// COCO RECOVERY")
                        .font(.system(size: 9, weight: .black))
                        .italic()
                        .foregroundColor(cocoRed)
                        .tracking(2)

                    HStack(alignment: .lastTextBaseline, spacing: 2) {
                        Text("\(entry.recoveryScore)")
                            .font(.system(size: 38, weight: .black))
                            .italic()
                            .foregroundColor(scoreColor(entry.recoveryScore))
                        Text("%")
                            .font(.system(size: 14, weight: .black))
                            .italic()
                            .foregroundColor(.white.opacity(0.4))
                    }

                    Text("RECOVERY")
                        .font(.system(size: 7, weight: .black))
                        .italic()
                        .foregroundColor(.white.opacity(0.4))
                        .tracking(2)

                    Spacer()

                    Link(destination: URL(string: "coco-sleep://begin-sleep")!) {
                        Text("BEGIN SLEEP →")
                            .font(.system(size: 10, weight: .black))
                            .italic()
                            .foregroundColor(.white)
                            .tracking(1)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(cocoRed)
                    }
                }
            }
            .padding(.leading, 14)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Medium widget
struct CocoMediumView: View {
    let entry: CocoEntry

    var body: some View {
        ZStack(alignment: .leading) {
            cocoWidgetBg

            HStack(spacing: 0) {
                Rectangle().fill(cocoRed).frame(width: 4)
                Spacer()
            }

            HStack(spacing: 0) {
                // Left: growth stage image + Level label
                VStack(spacing: 4) {
                    Group {
                        if let ui = UIImage(named: entry.growthImageName) {
                            Image(uiImage: ui)
                                .resizable()
                                .scaledToFit()
                        } else {
                            Image(systemName: "leaf.fill")
                                .resizable()
                                .scaledToFit()
                        }
                    }
                    .frame(width: 108, height: 108)
                    Text("LEVEL \(entry.cocoLevelNum)")
                        .font(.system(size: 19, weight: .black))
                        .italic()
                        .foregroundColor(Color(red: 0.96, green: 0.78, blue: 0.26))  // gold
                        .tracking(1)
                }
                .frame(maxWidth: .infinity)
                .padding(.leading, 14)
                .padding(.trailing, 8)

                // Red vertical divider
                Rectangle()
                    .fill(cocoRed)
                    .frame(width: 3)
                    .padding(.vertical, 14)

                // Right: streak at top, button below
                VStack(alignment: .center, spacing: 10) {
                    VStack(spacing: 2) {
                        Text("\(entry.streak)")
                            .font(.system(size: 36, weight: .black))
                            .italic()
                            .foregroundColor(streakColor(entry.streak))
                        Text("DAY STREAK")
                            .font(.system(size: 8, weight: .black))
                            .italic()
                            .foregroundColor(.white.opacity(0.35))
                            .tracking(2)
                    }
                    Link(destination: URL(string: "coco-sleep://begin-sleep")!) {
                        Text(entry.isTracking ? "WAKE UP →" : "BEGIN SLEEP →")
                            .font(.system(size: 11, weight: .black))
                            .italic()
                            .foregroundColor(.white)
                            .tracking(1)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(cocoRed)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.leading, 8)
                .padding(.trailing, 18)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct StatPill: View {
    let label: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 7, weight: .black))
                .italic()
                .foregroundColor(.white.opacity(0.35))
                .tracking(2)
            Text(value)
                .font(.system(size: 13, weight: .black))
                .italic()
                .foregroundColor(.white)
                .lineLimit(1)
        }
    }
}

// MARK: - Lock screen (accessory) widgets
struct CocoAccessoryCircularView: View {
    let entry: CocoEntry
    var body: some View {
        ZStack {
            if entry.isTracking {
                Text("ZZ")
                    .font(.system(size: 14, weight: .black))
                    .italic()
                    .foregroundColor(.white.opacity(0.7))
            } else {
                Gauge(value: Double(entry.recoveryScore), in: 0...100) {
                    Text("REC")
                } currentValueLabel: {
                    Text("\(entry.recoveryScore)")
                        .font(.system(size: 14, weight: .black))
                        .italic()
                }
                .gaugeStyle(.accessoryCircular)
                .tint(scoreColor(entry.recoveryScore))
            }
        }
    }
}

struct CocoAccessoryRectangularView: View {
    let entry: CocoEntry
    var body: some View {
        Link(destination: URL(string: "coco-sleep://begin-sleep")!) {
            VStack(alignment: .leading, spacing: 4) {
                if entry.isTracking {
                    Text("// COCO RECOVERY")
                        .font(.system(size: 11, weight: .black))
                        .italic()
                    Text("WAKE UP →")
                        .font(.system(size: 10, weight: .black))
                        .italic()
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .overlay(
                            RoundedRectangle(cornerRadius: 3)
                                .stroke(Color.white.opacity(0.8), lineWidth: 1)
                        )
                } else {
                    Text("// COCO RECOVERY")
                        .font(.system(size: 11, weight: .black))
                        .italic()
                    Text("BEGIN SLEEP →")
                        .font(.system(size: 10, weight: .black))
                        .italic()
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .overlay(
                            RoundedRectangle(cornerRadius: 3)
                                .stroke(Color.white.opacity(0.8), lineWidth: 1)
                        )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct CocoAccessoryInlineView: View {
    let entry: CocoEntry
    var body: some View {
        if entry.isTracking {
            Label("Coco tracking", systemImage: "moon.zzz.fill")
        } else {
            Label("\(entry.recoveryScore)% recovery · \(entry.streak)d streak", systemImage: "heart.fill")
        }
    }
}

// MARK: - Entry view
struct CocoWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: CocoEntry

    var body: some View {
        switch family {
        case .systemSmall:
            CocoSmallView(entry: entry)
        case .systemMedium:
            CocoMediumView(entry: entry)
        case .accessoryCircular:
            CocoAccessoryCircularView(entry: entry)
        case .accessoryRectangular:
            CocoAccessoryRectangularView(entry: entry)
        case .accessoryInline:
            CocoAccessoryInlineView(entry: entry)
        default:
            CocoSmallView(entry: entry)
        }
    }
}

// MARK: - Widget configuration
// @available(iOSApplicationExtension 17.0, *) lets us freely use
// containerBackground and contentMarginsDisabled — both require iOS 17.
// The widget simply won't appear on iOS 16, which is fine for modern hardware.
@available(iOSApplicationExtension 17.0, *)
struct CocoWidget: Widget {
    let kind: String = "CocoWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CocoProvider()) { entry in
            CocoWidgetEntryView(entry: entry)
                .containerBackground(cocoWidgetBg, for: .widget)
        }
        .configurationDisplayName("Coco Recovery")
        .description("Track your sleep recovery and streak.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline,
        ])
        .contentMarginsDisabled()
    }
}
