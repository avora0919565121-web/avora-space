import SwiftUI

/// Tài chính sau khi mở Két sắt: tổng số dư, tài khoản, giao dịch gần đây (chỉ đọc — sửa trên web).
struct FinanceView: View {
    @State private var accounts: [FinanceAccount] = []
    @State private var txns: [FinanceTxn] = []
    @State private var loading = true
    @State private var error: String?
    @State private var hideAmounts = false

    private var vndTotal: Double {
        accounts.filter { ($0.currency ?? "VND") == "VND" }.reduce(0) { $0 + ($1.balance ?? 0) }
    }

    private var monthFlow: (inflow: Double, outflow: Double) {
        let cal = Calendar.current
        let now = Date()
        var i = 0.0, o = 0.0
        for t in txns where (t.currency ?? "VND") == "VND" {
            guard let d = AvDate.day(t.transaction_date), cal.isDate(d, equalTo: now, toGranularity: .month) else { continue }
            if t.type == "income" { i += t.amount } else if t.type == "expense" { o += t.amount }
        }
        return (i, o)
    }

    private var byDay: [(Date, [FinanceTxn])] {
        let groups = Dictionary(grouping: txns) { AvDate.day($0.transaction_date) ?? .distantPast }
        return groups.keys.sorted(by: >).map { ($0, groups[$0] ?? []) }
    }

    var body: some View {
        List {
            if let error {
                AvErrorBanner(message: error) { Task { await load() } }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            Section {
                summary
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            Section {
                if loading && accounts.isEmpty {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 8).fill(Av.sand).frame(height: 40).redacted(reason: .placeholder)
                    }
                } else if accounts.isEmpty {
                    Text("Chưa có tài khoản nào.").foregroundStyle(Av.muted)
                } else {
                    ForEach(accounts) { a in accountRow(a) }
                }
            } header: {
                AvSectionLabel(title: "Tài khoản", count: accounts.count)
            }
            .listRowBackground(Av.card)

            ForEach(byDay, id: \.0) { day, items in
                Section {
                    ForEach(items) { t in txnRow(t) }
                } header: {
                    AvSectionLabel(title: AvFormat.dayHeader(day))
                }
                .listRowBackground(Av.card)
            }
            if !loading && txns.isEmpty && !accounts.isEmpty {
                Text("Chưa có giao dịch nào.")
                    .foregroundStyle(Av.muted)
                    .listRowBackground(Color.clear)
            }
            Section {
                Link(destination: WebLinks.vault) {
                    Label("Thêm và sửa giao dịch trên web", systemImage: "safari")
                        .font(.subheadline)
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .avScreen()
        .refreshable { await load() }
        .task { await load() }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Tổng số dư").font(.subheadline.weight(.medium)).foregroundStyle(Av.accentInk)
                Spacer()
                Button {
                    withAnimation(.snappy) { hideAmounts.toggle() }
                } label: {
                    Image(systemName: hideAmounts ? "eye.slash" : "eye")
                        .foregroundStyle(Av.accentInk)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(hideAmounts ? "Hiện số tiền" : "Ẩn số tiền")
            }
            Text(amount(vndTotal, nil))
                .font(.system(size: 34, weight: .heavy, design: .rounded))
                .foregroundStyle(Av.ink)
                .contentTransition(.numericText())
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            HStack(spacing: 10) {
                flowPill(title: "Thu tháng này", value: monthFlow.inflow, icon: "arrow.down.left", color: Av.success)
                flowPill(title: "Chi tháng này", value: monthFlow.outflow, icon: "arrow.up.right", color: Av.danger)
            }
        }
        .padding(18)
        .background(Av.accentSoft, in: .rect(cornerRadius: Av.radius))
    }

    private func flowPill(title: String, value: Double, icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(title, systemImage: icon).font(.caption).foregroundStyle(Av.muted)
            Text(amount(value, nil)).font(.subheadline.weight(.semibold)).foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.6)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Av.card.opacity(0.8), in: .rect(cornerRadius: 12))
    }

    private func accountRow(_ a: FinanceAccount) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon(for: a.type))
                .foregroundStyle(Av.accentInk)
                .frame(width: 34, height: 34)
                .background(Av.accentSoft, in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(a.name).font(.body.weight(.medium)).foregroundStyle(Av.ink)
                Text(a.other_person_name.map { "\(a.typeLabel) · \($0)" } ?? a.typeLabel)
                    .font(.caption).foregroundStyle(Av.muted)
            }
            Spacer()
            Text(amount(a.balance ?? 0, a.currency))
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle((a.balance ?? 0) < 0 ? Av.danger : Av.ink)
        }
    }

    private func txnRow(_ t: FinanceTxn) -> some View {
        let account = accounts.first { $0.id == t.account_id }
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(t.description?.isEmpty == false ? t.description! : t.typeLabel)
                    .font(.body).foregroundStyle(Av.ink).lineLimit(1)
                Text([t.typeLabel, account?.name].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Av.muted)
            }
            Spacer()
            Text((t.isInflow ? "+" : "−") + amount(t.amount, t.currency))
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(t.isInflow ? Av.success : Av.ink)
        }
    }

    private func amount(_ v: Double, _ currency: String?) -> String {
        hideAmounts ? "••••••" : AvFormat.money(v, currency: currency)
    }

    private func icon(for type: String) -> String {
        switch type {
        case "cash": return "banknote"
        case "checking": return "building.columns"
        case "savings": return "leaf"
        case "credit": return "creditcard"
        case "investment": return "chart.line.uptrend.xyaxis"
        default: return "wallet.pass"
        }
    }

    private func load() async {
        do {
            async let a = Repo.accounts()
            async let t = Repo.transactions()
            let (aa, tt) = try await (a, t)
            accounts = aa
            txns = tt
            error = nil
        } catch {
            self.error = AvError.message(error)
        }
        loading = false
    }
}
