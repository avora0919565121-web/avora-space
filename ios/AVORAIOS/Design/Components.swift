import SwiftUI

/// Tab con gạch chân — giống thanh "Thói quen · Hôm nay · Sắp tới · Tất cả" của web.
struct UnderlineTabs<Tab: Hashable>: View {
    let tabs: [(Tab, String, Int?)]
    @Binding var selection: Tab
    @Namespace private var ns

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 22) {
                ForEach(tabs, id: \.0) { tab, title, count in
                    Button {
                        withAnimation(.snappy(duration: 0.25)) { selection = tab }
                    } label: {
                        VStack(spacing: 8) {
                            HStack(alignment: .firstTextBaseline, spacing: 3) {
                                Text(title)
                                    .font(.subheadline.weight(selection == tab ? .bold : .medium))
                                    .foregroundStyle(selection == tab ? Av.ink : Av.muted)
                                if let count, count > 0 {
                                    Text("\(count)").font(.caption2.weight(.semibold)).foregroundStyle(Av.muted)
                                }
                            }
                            ZStack {
                                Rectangle().fill(.clear).frame(height: 2)
                                if selection == tab {
                                    Capsule().fill(Av.accent).frame(height: 2).matchedGeometryEffect(id: "u", in: ns)
                                }
                            }
                        }
                        .fixedSize()
                    }
                    .buttonStyle(.plain)
                    .sensoryFeedback(.selection, trigger: selection == tab)
                }
            }
            .padding(.horizontal, 16)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Av.border).frame(height: 1) }
    }
}

/// Logo chữ "A" ở góc trái mỗi tab — chạm để mở Avora Space (Tổng quan).
struct AvoraMarkButton: View {
    @Environment(AppModel.self) private var app
    var body: some View {
        Button {
            app.showSpace = true
        } label: {
            AvoraMarkImage(size: 32)
        }
        .accessibilityLabel("Avora Space")
    }
}

/// Dấu AVORA (cùng ảnh `/icon.png` của web).
struct AvoraMarkImage: View {
    var size: CGFloat = 32
    var body: some View {
        Image("AvoraMark")
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(.rect(cornerRadius: size * 0.22))
    }
}

/// Tiêu đề lớn đậm + nút góc phải, đặt trên đầu nội dung tab (không dùng thanh điều hướng mặc định
/// để giữ đúng dáng web).
struct AvTabHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            AvoraMarkButton()
            Text(title)
                .font(.system(size: 30, weight: .heavy))
                .foregroundStyle(Av.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
    }
}

extension AvTabHeader where Trailing == EmptyView {
    init(title: String) {
        self.title = title
        self.trailing = { EmptyView() }
    }
}

/// Ô tìm nội dòng (dùng khi thanh điều hướng ẩn để giữ dáng tiêu đề web).
struct AvSearchField: View {
    @Binding var text: String
    var prompt: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Av.muted)
            TextField(prompt, text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Av.muted) }
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Av.card, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Av.border))
    }
}

/// Thông báo lỗi mảnh, chạm để thử lại.
struct AvErrorBanner: View {
    let message: String
    var retry: (() -> Void)? = nil
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Av.danger)
            Text(message).font(.subheadline).foregroundStyle(Av.ink)
            Spacer(minLength: 0)
            if let retry {
                Button("Thử lại", action: retry).font(.subheadline.weight(.semibold)).foregroundStyle(Av.accent)
            }
        }
        .padding(12)
        .background(Av.accentSoft.opacity(0.6), in: .rect(cornerRadius: 12))
        .padding(.horizontal, 16)
    }
}
