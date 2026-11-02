import SwiftUI

/// Avora Space — Tổng quan: lời chào, Góc suy ngẫm, Cần chú ý hôm nay, Kết nối, Đọc tiếp.
struct SpaceView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var tasks: [TaskItem] = []
    @State private var inbox: [InboxRow] = []
    @State private var reading: (record: ThinkRecord, state: ReadingState?)?
    @State private var loaded = false
    @State private var showReply = false
    @State private var savedReply = false

    private var thought: DailyThought.Line? { DailyThought.today(category: app.profile?.daily_thought_category) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    greeting
                    if let thought { thoughtCard(thought) }
                    attention
                    communication
                    if let reading { readingCard(reading.record, reading.state) }
                }
                .padding(16)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .avScreen()
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    HStack(spacing: 8) {
                        AvoraMarkImage(size: 28)
                        Text("Avora Space").font(.headline).foregroundStyle(Av.ink)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Xong") { dismiss() }.fontWeight(.semibold)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .refreshable { await load() }
            .sheet(isPresented: $showReply) {
                if let thought {
                    ThoughtReplySheet(thought: thought) { savedReply = true }
                        .presentationDetents([.medium, .large])
                }
            }
        }
    }

    // MARK: Lời chào

    private var greeting: some View {
        let hour = Calendar.current.component(.hour, from: Date())
        let hello = hour < 11 ? "Chào buổi sáng" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối"
        let date = Date().formatted(.dateTime.weekday(.wide).day().month(.abbreviated).locale(AvFormat.vi))
        return (
            Text("\(hello), ").foregroundStyle(Av.muted)
            + Text(app.displayName).fontWeight(.heavy).foregroundStyle(Av.ink)
            + Text(" · \(date.capitalized(with: AvFormat.vi))").foregroundStyle(Av.muted)
        )
        .font(.title3)
        .padding(.top, 4)
    }

    // MARK: Góc suy ngẫm

    private func thoughtCard(_ t: DailyThought.Line) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(t.text)
                .font(.system(.title3, design: .serif))
                .foregroundStyle(Av.ink)
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
            Text("Chạm “Viết lời bình” để lưu vào Nhật ký — chỉ bạn đọc được.")
                .font(.caption)
                .foregroundStyle(Av.muted.opacity(0.8))
            Button {
                showReply = true
            } label: {
                Label(savedReply ? "Đã lưu vào Nhật ký" : "Viết lời bình", systemImage: savedReply ? "checkmark" : "square.and.pencil")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(savedReply ? Av.success : Av.accent)
            }
            .disabled(savedReply)
        }
        .padding(.leading, 14)
        .padding(.vertical, 4)
        .overlay(alignment: .leading) {
            Capsule().fill(Av.accent.opacity(0.55)).frame(width: 3)
        }
        .padding(.vertical, 6)
    }

    // MARK: Cần chú ý hôm nay

    private var todayTasks: [TaskItem] {
        let today = Calendar.current.startOfDay(for: Date())
        return tasks.filter { t in
            guard !t.isDone, let d = t.deadline else { return false }
            return d <= today
        }
    }

    private var attention: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Cần chú ý hôm nay").font(.headline).foregroundStyle(Av.ink)
                Spacer()
                if !todayTasks.isEmpty {
                    Text("\(todayTasks.count)")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Av.accentInk)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Av.accentSoft, in: .capsule)
                }
            }
            if !loaded {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if todayTasks.isEmpty {
                Text("Chưa có gì cần làm hôm nay.").font(.subheadline).foregroundStyle(Av.muted)
            } else {
                ForEach(todayTasks.prefix(4)) { t in
                    HStack(spacing: 10) {
                        Circle().strokeBorder(Av.border, lineWidth: 1.5).frame(width: 18, height: 18)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.title).font(.subheadline).foregroundStyle(Av.ink).lineLimit(1)
                            Text(dueText(t)).font(.caption).foregroundStyle(isOverdue(t) ? Av.danger : Av.muted)
                        }
                    }
                }
                if todayTasks.count > 4 {
                    Text("và \(todayTasks.count - 4) việc nữa").font(.caption).foregroundStyle(Av.muted)
                }
            }
            Button {
                app.selectedTab = .tasks
                dismiss()
            } label: {
                Text("Mở Nhiệm vụ").font(.subheadline.weight(.semibold)).foregroundStyle(Av.accent)
            }
        }
        .avCard()
    }

    private func isOverdue(_ t: TaskItem) -> Bool {
        guard let d = t.deadline else { return false }
        return d < Calendar.current.startOfDay(for: Date())
    }

    private func dueText(_ t: TaskItem) -> String {
        if isOverdue(t), let d = t.deadline {
            return "Quá hạn · \(d.formatted(.dateTime.day().month(.twoDigits).locale(AvFormat.vi)))"
        }
        return AvFormat.hhmm(t.deadline_time) ?? "Trong ngày"
    }

    // MARK: Kết nối

    private var unreadRows: [InboxRow] { inbox.filter { ($0.unread_count ?? 0) > 0 } }

    @ViewBuilder
    private var communication: some View {
        if !unreadRows.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Kết nối").font(.headline).foregroundStyle(Av.ink)
                Text("Những cuộc trò chuyện đang có tin bạn chưa đọc.").font(.caption).foregroundStyle(Av.muted)
                ForEach(unreadRows.prefix(4)) { row in
                    HStack(spacing: 10) {
                        AvAvatar(name: row.title, size: 32, isGroup: row.isGroup)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(row.title).font(.subheadline.weight(.semibold)).foregroundStyle(Av.ink).lineLimit(1)
                            Text(row.last_message_content ?? "").font(.caption).foregroundStyle(Av.muted).lineLimit(1)
                        }
                        Spacer()
                        Text("\(row.unread_count ?? 0)")
                            .font(.caption2.weight(.bold)).foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(Av.accent, in: .capsule)
                    }
                }
                Button {
                    app.selectedTab = .connect
                    dismiss()
                } label: {
                    Text("Mở Kết nối").font(.subheadline.weight(.semibold)).foregroundStyle(Av.accent)
                }
            }
            .avCard()
        }
    }

    // MARK: Đọc tiếp

    private func readingCard(_ record: ThinkRecord, _ state: ReadingState?) -> some View {
        HStack(spacing: 14) {
            BookCover(title: record.displayTitle, size: CGSize(width: 46, height: 64))
            VStack(alignment: .leading, spacing: 4) {
                Text("Đọc tiếp").font(.caption.weight(.bold)).foregroundStyle(Av.muted)
                Text(record.displayTitle).font(.subheadline.weight(.semibold)).foregroundStyle(Av.ink).lineLimit(2)
                if let p = state?.percent {
                    ProgressView(value: min(max(p / 100, 0), 1)).tint(Av.accent)
                    Text("\(Int(p))%").font(.caption2).foregroundStyle(Av.muted)
                }
            }
        }
        .avCard()
        .onTapGesture {
            app.selectedTab = .plan
            dismiss()
        }
    }

    // MARK: Tải

    private func load() async {
        guard let me = app.userId else { return }
        async let t = try? await Repo.tasks(me: me)
        async let i = try? await Repo.inbox()
        async let r = loadReading()
        tasks = await t ?? []
        inbox = await i ?? []
        reading = await r
        loaded = true
    }

    private func loadReading() async -> (record: ThinkRecord, state: ReadingState?)? {
        guard let states = try? await Repo.readingStates(), let latest = states.max(by: { $0.updated_at < $1.updated_at }) else { return nil }
        guard let shelf = try? await Repo.ensureBookshelf(), let books = try? await Repo.records(shelf.id) else { return nil }
        guard let book = books.first(where: { $0.id == latest.record_id }) else { return nil }
        return (record: book, state: latest)
    }
}

/// Viết lời bình cho câu hôm nay → gửi vào Nhật ký kèm khoá câu (giống web).
struct ThoughtReplySheet: View {
    let thought: DailyThought.Line
    var onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text(thought.text)
                    .font(.system(.body, design: .serif))
                    .foregroundStyle(Av.muted)
                    .padding(.leading, 12)
                    .overlay(alignment: .leading) { Capsule().fill(Av.accent.opacity(0.5)).frame(width: 3) }
                TextField("Điều câu này gợi ra cho bạn…", text: $text, axis: .vertical)
                    .lineLimit(4...12)
                    .focused($focused)
                    .padding(14)
                    .background(Av.card, in: .rect(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Av.border))
                if let error { Text(error).font(.footnote).foregroundStyle(Av.danger) }
                Spacer()
            }
            .padding(16)
            .avScreen()
            .navigationTitle("Viết lời bình")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Huỷ") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Đang lưu…" : "Lưu") { save() }
                        .fontWeight(.semibold)
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                }
            }
            .onAppear { focused = true }
        }
    }

    private func save() {
        busy = true
        Task {
            do {
                let journal = try await Repo.journalConversation()
                try await Repo.send(journal, text: text.trimmingCharacters(in: .whitespacesAndNewlines), dailyThought: thought.id)
                onSaved()
                dismiss()
            } catch {
                self.error = AvError.message(error)
            }
            busy = false
        }
    }
}
