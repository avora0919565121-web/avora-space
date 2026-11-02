import Foundation

/// Địa chỉ bản web — dùng cho phần chưa có trên iOS (đăng ký, Két sắt mã hoá, chính sách).
enum WebLinks {
    static let origin = URL(string: "https://avorachat.com")!
    static let signUp = origin.appending(path: "dang-ky")
    static let vault = origin.appending(path: "ket-sat")
    static let policy = origin.appending(path: "chinh-sach")
    static let settings = origin.appending(path: "cai-dat")
}
