import SwiftUI

/// Nhiệm vụ — Hôm nay · Sắp tới · Tất cả; tạo việc cá nhân, chạm ô vuông để xong.
struct TasksView: View {
    enum Sub: Hashable { case today, upcoming, all }

    @Environment(AppModel.self) private var app
    @State private var sub: Sub = .today
    @State private var tasks: [TaskItem] = []
    @State private var loading = true
    @State private var error: String?
    @State private var showNew = false
    @State private var showDone = false
    @State private var doneTick = 0

    private var startOfToday: Date { Calendar.current.startOfDay(for: Date()) }

    private var open: [TaskItem] { tasks.filter { !$0.isDone } }
    private var today: [TaskItem] { open.filter { ($0.deadline ?? .distantFuture) <= startOfToday } }
    private var upcoming: [TaskItem] { open.filter { ($0.deadline ?? .distantPast) > startOfToday } }
    private var done: [TaskItem] {
        tasks.filter(\.isDone).sorted { ($0.done_at ?? "") > ($1.done_at ?? "") }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                AvTabHeader(title: "Nhiệm vụ") {
                    Button { showNew = true } label: { Image(systemName: "plus") }
                        .buttonStyle(AvRoundButtonStyle(filled: true))
                        .accessibilityLabel("Việc mới")
                }
                UnderlineTabs(
                    tabs: [(Sub.today, "Hôm nay", today.count), (Sub.upcoming, "Sắp tới", upcoming.count), (Sub.all, "Tất cả", open.count)],
                    selection: $sub
                )
                list
            }
            .background(Av.paper.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: TaskItem.self) { t in
                TaskDetailView(task: t, canToggle: canToggle(t)) { await toggle(t) }
                    .toolbar(.visible, for: .navigationBar)
            }
        }
        .task { await load() }
        .onChange(of: app.selectedTab) { _, tab in if tab == .tasks { Task { await load() } } }
        .sheet(isPresented: $showNew) {
            NewTaskSheet { t in
                withAnimation(.snappy) { tasks.append(t) }
            }
            .presentationDetents([.medium, .large])
        }
        .sensoryFeedback(.success, trigger: doneTick)
    }

    private var list: some View {
        List {
            if let error {
                AvErrorBanner(message: error) { Task { await load() } }
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            switch sub {
            case .today:
                section("Hôm nay", today, empty: "Chưa có gì cần làm hôm nay.")
            case .upcoming:
                let groups = Dictionary(grouping: upcoming) { $0.deadline ?? startOfToday }
                if upcoming.isEmpty && !loading {
                    emptyRow("Không có việc nào sắp tới.")
                }
                ForEach(groups.keys.sorted(), id: \.self) { day in
                    section(AvFormat.dayHeader(day), groups[day] ?? [], empty: nil)
                }
            case .all:
                section("Đang mở", open.sorted { ($0.deadline ?? .distantFuture) < ($1.deadline ?? .distantFuture) }, empty: "Không còn việc nào đang mở.")
                if !done.isEmpty {
                    Section {
                        if showDone {
                            ForEach(done.prefix(50)) { row($0) }
                        }
                    } header: {
                        Button {
                            withAnimation(.snappy) { showDone.toggle() }
                        } label: {
                            HStack {
                                AvSectionLabel(title: "Đã xong", count: done.count)
                                Image(systemName: "chevron.down").font(.caption2.weight(.bold)).foregroundStyle(Av.muted)
                                    .rotationEffect(.degrees(showDone ? 0 : -90))
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.plain)
        .avScreen()
        .refreshable { await load() }
        .overlay {
            if loading && tasks.isEmpty { ProgressView() }
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ rows: [TaskItem], empty: String?) -> some View {
        Section {
            if rows.isEmpty, let empty, !loading {
                emptyRow(empty)
            }
            ForEach(rows) { row($0) }
        } header: {
            AvSectionLabel(title: title, count: rows.count)
        }
    }

    private func emptyRow(_ text: String) -> some View {
        AvEmpty(icon: "checkmark.circle", title: text)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }

    private func row(_ t: TaskItem) -> some View {
        NavigationLink(value: t) {
            TaskRow(task: t, me: app.userId, canToggle: canToggle(t), overdue: isOverdue(t)) {
                Task { await toggle(t) }
            }
        }
        .listRowBackground(
            HStack(spacing: 0) {
                Rectangle().fill(isOverdue(t) ? Av.accent : .clear).frame(width: 3)
                (isOverdue(t) ? Av.accentSoft.opacity(0.35) : Color.clear)
            }
        )
        .listRowSeparatorTint(Av.border)
        .swipeActions(edge: .leading) {
            if canToggle(t) {
                Button { Task { await toggle(t) } } label: {
                    Label(t.isDone ? "Mở lại" : "Xong", systemImage: t.isDone ? "arrow.uturn.backward" : "checkmark")
                }
                .tint(t.isDone ? Av.muted : Av.success)
            }
        }
    }

    private func isOverdue(_ t: TaskItem) -> Bool {
        guard !t.isDone, let d = t.deadline else { return false }
        return d < startOfToday
    }

    /// Việc cá nhân của mình đổi trạng thái ngay; việc chung cần xác nhận hai bên → làm trên web.
    private func canToggle(_ t: TaskItem) -> Bool {
        t.type == "personal" && t.creator_id == app.userId
    }

    private func toggle(_ t: TaskItem) async {
        guard canToggle(t), let i = tasks.firstIndex(where: { $0.id == t.id }) else { return }
        let makeDone = !t.isDone
        withAnimation(.snappy) {
            tasks[i].status = makeDone ? "done" : "confirmed"
            tasks[i].done_at = makeDone ? AvDate.nowISO() : nil
        }
        if makeDone { doneTick += 1 }
        do {
            try await Repo.setTaskDone(t.id, done: makeDone)
        } catch {
            if let j = tasks.firstIndex(where: { $0.id == t.id }) { tasks[j] = t }
            self.error = AvError.message(error)
        }
    }

    private func load() async {
        guard let me = app.userId else { return }
        do {
            tasks = try await Repo.tasks(me: me)
            error = nil
        } catch {
            self.error = AvError.message(error)
        }
        loading = false
    }
}

private struct TaskRow: View {
    let task: TaskItem
    let me: UUID?
    let canToggle: Bool
    let overdue: Bool
    var toggle: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: toggle) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(task.isDone ? Av.accent : Av.card)
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(task.isDone ? .clear : Av.border, lineWidth: 1.5))
                    if task.isDone {
                        Image(systemName: "checkmark").font(.caption.weight(.heavy)).foregroundStyle(.white)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                .frame(width: 26, height: 26)
                .opacity(canToggle ? 1 : 0.5)
            }
            .buttonStyle(.plain)
            .disabled(!canToggle)

            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(task.isDone ? Av.muted : Av.ink)
                    .strikethrough(task.isDone, color: Av.muted)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(when).foregroundStyle(overdue ? Av.danger : Av.muted)
                    Text("·").foregroundStyle(Av.muted)
                    Label(owner, systemImage: task.type == "personal" ? "person" : "person.2")
                        .labelStyle(.titleAndIcon)
                        .foregroundStyle(Av.accent)
                }
                .font(.caption)
            }
        }
        .padding(.vertical, 4)
    }

    private var when: String {
        let time = AvFormat.hhmm(task.deadline_time)
        guard let d = task.deadline else { return time ?? "Không hạn" }
        let cal = Calendar.current
        if cal.isDateInToday(d) { return time ?? "Trong ngày" }
        let day = d.formatted(.dateTime.day().month(.twoDigits).locale(AvFormat.vi))
        if overdue { return "Quá hạn · \(day)" }
        return [day, time].compactMap { $0 }.joined(separator: " ")
    }

    private var owner: String {
        if task.type == "personal" { return "Của tôi" }
        if task.assignee_id == me { return "Giao cho tôi" }
        return "Việc chung"
    }
}

private struct TaskDetailView: View {
    let task: TaskItem
    let canToggle: Bool
    var toggle: () async -> Void
    @State private var isDone: Bool

    init(task: TaskItem, canToggle: Bool, toggle: @escaping () async -> Void) {
        self.task = task
        self.canToggle = canToggle
        self.toggle = toggle
        _isDone = State(initialValue: task.isDone)
    }

    var body: some View {
        List {
            Section {
                Text(task.title).font(.title2.weight(.heavy)).foregroundStyle(Av.ink)
                    .listRowBackground(Color.clear)
            }
            Section {
                if let d = task.deadline {
                    LabeledContent("Hạn", value: d.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(AvFormat.vi)))
                }
                LabeledContent("Giờ", value: AvFormat.hhmm(task.deadline_time) ?? "Trong ngày")
                LabeledContent("Trạng thái", value: isDone ? "Đã xong" : (task.status == "pending_confirmation" ? "Chờ xác nhận" : "Đang làm"))
                LabeledContent("Loại", value: task.type == "personal" ? "Việc của tôi" : "Việc chung")
            }
            .listRowBackground(Av.card)
            if let desc = task.description, !desc.isEmpty {
                Section("Mô tả") { Text(desc).foregroundStyle(Av.ink) }.listRowBackground(Av.card)
            }
            Section {
                if canToggle {
                    Button {
                        Task {
                            await toggle()
                            isDone.toggle()
                        }
                    } label: {
                        Label(isDone ? "Mở lại việc này" : "Đánh dấu đã xong", systemImage: isDone ? "arrow.uturn.backward" : "checkmark.circle.fill")
                            .fontWeight(.semibold)
                    }
                    .listRowBackground(Av.card)
                } else {
                    Text("Việc chung cần hai bên xác nhận — đổi trạng thái trên avorachat.com.")
                        .font(.footnote).foregroundStyle(Av.muted)
                        .listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.insetGrouped)
        .avScreen()
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct NewTaskSheet: View {
    var onCreated: (TaskItem) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var date = Date()
    @State private var hasTime = false
    @State private var time = Calendar.current.date(bySettingHour: 17, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Circle().strokeBorder(Av.border, lineWidth: 2).frame(width: 24, height: 24)
                    TextField("Việc cần làm là gì?", text: $title, axis: .vertical)
                        .font(.title3.weight(.bold))
                        .focused($focus)
                        .submitLabel(.done)
                }
                VStack(spacing: 0) {
                    DatePicker("Ngày", selection: $date, displayedComponents: .date)
                        .padding(.vertical, 10)
                    Divider().overlay(Av.border)
                    Toggle("Có giờ cụ thể", isOn: $hasTime.animation(.snappy))
                        .padding(.vertical, 10)
                    if hasTime {
                        Divider().overlay(Av.border)
                        DatePicker("Giờ", selection: $time, displayedComponents: .hourAndMinute)
                            .padding(.vertical, 10)
                    }
                }
                .padding(.horizontal, 14)
                .background(Av.card, in: .rect(cornerRadius: Av.radius))
                .overlay(RoundedRectangle(cornerRadius: Av.radius).strokeBorder(Av.border))
                Text("Giao cho: Của tôi. Việc chung giao cho người khác tạo trong cuộc trò chuyện trên web.")
                    .font(.caption).foregroundStyle(Av.muted)
                if let error { Text(error).font(.footnote).foregroundStyle(Av.danger) }
                Spacer()
            }
            .padding(16)
            .avScreen()
            .navigationTitle("Nhiệm vụ mới")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Huỷ") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Tạo", action: save).fontWeight(.semibold)
                        .disabled(busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear { focus = true }
        }
    }

    private func save() {
        guard let me = app.userId else { return }
        busy = true
        Task {
            do {
                let t = try await Repo.createPersonalTask(
                    me: me,
                    title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                    deadline: date,
                    time: hasTime ? time : nil
                )
                onCreated(t)
                dismiss()
            } catch {
                self.error = AvError.message(error)
            }
            busy = false
        }
    }
}
