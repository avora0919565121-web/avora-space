import SwiftUI
import UIKit

/// Token thiết kế — khớp `web/src/index.css` (giấy ấm, mực, nhấn đất nung), có bản tối.
enum Av {
    static let paper = dyn(light: 0xF6F3EC, dark: 0x191714)
    static let card = dyn(light: 0xFFFFFF, dark: 0x24211F)
    static let ink = dyn(light: 0x1C1A17, dark: 0xF1EDE4)
    static let muted = dyn(light: 0x6B635A, dark: 0xB6AFA5)
    static let accent = dyn(light: 0xE0603C, dark: 0xE1603D)
    static let accentSoft = dyn(light: 0xF7E3DC, dark: 0x422C24)
    static let accentInk = dyn(light: 0xB8482A, dark: 0xEEB5A0)
    static let sand = dyn(light: 0xEFE7DA, dark: 0x312E2B)
    static let border = dyn(light: 0xE6DFD3, dark: 0x3D3834)
    static let danger = dyn(light: 0xC33228, dark: 0xE36158)
    static let success = dyn(light: 0x3E7B4F, dark: 0x7FC08F)

    static let radius: CGFloat = 16

    private static func dyn(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { trait in
            UIColor(hex: trait.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

/// Thẻ trắng bo 16, viền mảnh — thẻ chuẩn của web.
struct AvCard: ViewModifier {
    var padding: CGFloat = 16
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Av.card, in: .rect(cornerRadius: Av.radius))
            .overlay(RoundedRectangle(cornerRadius: Av.radius).strokeBorder(Av.border, lineWidth: 1))
    }
}

extension View {
    func avCard(padding: CGFloat = 16) -> some View { modifier(AvCard(padding: padding)) }

    /// Nền giấy cho cả màn.
    func avScreen() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(Av.paper.ignoresSafeArea())
    }
}

/// Nút chính màu đất nung.
struct AvPrimaryButtonStyle: ButtonStyle {
    var enabled: Bool = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity)
            .background(Av.accent.opacity(enabled ? 1 : 0.45), in: .rect(cornerRadius: 12))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

/// Nút viên tròn nhỏ (tìm, thêm) như góc phải tiêu đề web.
struct AvRoundButtonStyle: ButtonStyle {
    var filled = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(filled ? .white : Av.ink)
            .frame(width: 40, height: 40)
            .background(filled ? Av.accent : Av.card, in: .circle)
            .overlay(Circle().strokeBorder(filled ? .clear : Av.border, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

/// Tiêu đề nhóm viết hoa nhỏ ("HÔM NAY 60").
struct AvSectionLabel: View {
    let title: String
    var count: Int? = nil
    var body: some View {
        HStack(spacing: 6) {
            Text(title.uppercased())
                .font(.caption.weight(.bold))
                .tracking(0.8)
                .foregroundStyle(Av.muted)
            if let count {
                Text("\(count)").font(.caption.weight(.bold)).foregroundStyle(Av.muted.opacity(0.8))
            }
        }
    }
}

/// Ô tròn chữ cái đầu tên.
struct AvAvatar: View {
    let name: String
    var size: CGFloat = 40
    var isGroup = false
    var body: some View {
        ZStack {
            Circle().fill(Av.sand)
            if isGroup {
                Image(systemName: "person.3.fill").font(.system(size: size * 0.32)).foregroundStyle(Av.muted)
            } else {
                Text(initials).font(.system(size: size * 0.32, weight: .bold)).foregroundStyle(Av.muted)
            }
        }
        .frame(width: size, height: size)
    }

    private var initials: String {
        let parts = name.split(separator: " ").compactMap(\.first)
        guard let first = parts.first else { return "?" }
        if parts.count == 1 { return String(first).uppercased() }
        return (String(first) + String(parts.last!)).uppercased()
    }
}

/// Trạng thái trống/lỗi điềm tĩnh.
struct AvEmpty: View {
    let icon: String
    let title: String
    var message: String? = nil
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 28)).foregroundStyle(Av.muted.opacity(0.7))
            Text(title).font(.headline).foregroundStyle(Av.ink)
            if let message {
                Text(message).font(.subheadline).foregroundStyle(Av.muted).multilineTextAlignment(.center)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}
