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

    return CocoEntry(
        date: Date(),
        recoveryScore: intVal("recoveryScore"),
        streak: intVal("streak"),
        tierName: strVal("tierName"),
        isTracking: intVal("isTracking") == 1,
        cocoLevel: strVal("cocoLevel").isEmpty ? "normal" : strVal("cocoLevel")
    )
}

// Returns the coco image name for the given level
private func cocoImageName(_ level: String) -> String {
    switch level {
    case "bad":     return "coco_bad"
    case "leather": return "coco_leather"
    case "gold":    return "coco_gold"
    case "diamond": return "coco_diamond"
    default:        return "coco_normal"
    }
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

// Load a loose PNG from the widget extension bundle
private func cocoImage(_ level: String) -> Image {
    let name = cocoImageName(level)
    if let ui = UIImage(named: name) {
        return Image(uiImage: ui)
    }
    return Image(systemName: "moon.fill")
}

// MARK: - Provider
struct CocoProvider: TimelineProvider {
    func placeholder(in context: Context) -> CocoEntry {
        CocoEntry(date: Date(), recoveryScore: 82, streak: 7, tierName: "Coconut", isTracking: false, cocoLevel: "gold")
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

            if entry.isTracking {
                HStack(spacing: 0) {
                    // Left: coco image (same as idle)
                    cocoImage(entry.cocoLevel)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 76, height: 76)
                        .padding(.leading, 16)
                        .padding(.trailing, 14)

                    Rectangle()
                        .fill(cocoRed)
                        .frame(width: 3)
                        .padding(.vertical, 14)

                    // Right: WAKE UP button only
                    VStack(alignment: .center, spacing: 6) {
                        Text("// COCO RECOVERY")
                            .font(.system(size: 9, weight: .black))
                            .italic()
                            .foregroundColor(cocoRed)
                            .tracking(2)
                        Link(destination: URL(string: "coco-sleep://begin-sleep")!) {
                            Text("WAKE UP →")
                                .font(.system(size: 13, weight: .black))
                                .italic()
                                .foregroundColor(.white)
                                .tracking(1)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .background(cocoRed)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.trailing, 14)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(spacing: 0) {
                    // Left: coco image
                    cocoImage(entry.cocoLevel)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 76, height: 76)
                        .padding(.leading, 16)
                        .padding(.trailing, 14)

                    // Red vertical divider
                    Rectangle()
                        .fill(cocoRed)
                        .frame(width: 3)
                        .padding(.vertical, 14)

                    // Right: streak + BEGIN SLEEP centered
                    VStack(alignment: .center, spacing: 10) {
                        VStack(spacing: 2) {
                            Text("\(entry.streak)")
                                .font(.system(size: 40, weight: .black))
                                .italic()
                                .foregroundColor(streakColor(entry.streak))
                            Text("DAY STREAK")
                                .font(.system(size: 8, weight: .black))
                                .italic()
                                .foregroundColor(.white.opacity(0.35))
                                .tracking(2)
                        }
                        Link(destination: URL(string: "coco-sleep://begin-sleep")!) {
                            Text("BEGIN SLEEP →")
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
                    .padding(.trailing, 14)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
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
