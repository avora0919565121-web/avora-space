import type { VaultSection } from "@/lib/vault-crypto";

/**
 * KT-07c (CEO 12/11 · 17–19, SP-04 §3): four samples per encrypted compartment, static in the app.
 * They are never encrypted, never stored, never reminded about and never searched: a compartment
 * shows them so a person sees what it is for — even before a code exists. Dates are counted from
 * today each time, so "Còn N ngày" reads like a real item. Every number is fake and says "(mẫu)".
 */
export type VaultSample = {
  id: string;
  section: VaultSection;
  type: string;
  title: string;
  owner: string;
  /** Field key → value, in the template's own keys (dates as yyyy-mm-dd). */
  fields: Record<string, string>;
  note: string;
};

function shift(today: string, days: number, months = 0, years = 0): string {
  const [y, m, d] = today.split("-").map(Number);
  const at = new Date(y + years, m - 1 + months, d + days);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

export function vaultSamples(section: VaultSection, today: string): VaultSample[] {
  const s = (n: number, type: string, title: string, fields: Record<string, string>, owner = "Tôi", note = ""): VaultSample => ({
    id: `sample:${section}.${n}`, section, type, title, owner, fields, note,
  });
  switch (section) {
    case "passwords":
      return [
        s(1, "login", "Trang mua sắm (mẫu)", { site: "Trang mua sắm (ví dụ)", username: "ten.cua.ban@example.com", password: "mẫu-không-dùng-thật" }),
        s(2, "wifi", "Wi-Fi nhà (mẫu)", { ssid: "WiFi-Nha-Toi (mẫu)", password: "mẫu-wifi-không-dùng" }),
        s(3, "lock-code", "Khoá số cửa chính (mẫu)", { where: "Khoá số cửa chính", code: "MẪU-mã-khoá" }),
        s(4, "other-secret", "Mã dự phòng email (mẫu)", { secret: "mẫu · nơi ghi 10 mã dự phòng đăng nhập 2 lớp" }),
      ];
    case "certificates":
      return [
        s(1, "cccd", "Căn cước công dân (mẫu)", { number: "012 345 678 901 (mẫu)", issuer: "Cơ quan cấp (mẫu)", issued_on: shift(today, 0, 0, -10), expires_on: shift(today, 75) }),
        s(2, "driving", "Giấy phép lái xe hạng B (mẫu)", { number: "0000 0000 0000 (mẫu)", class: "B", issued_on: shift(today, 0, 0, -2), expires_on: shift(today, 0, 0, 8) }),
        s(3, "degree", "Bằng cử nhân (mẫu)", { school: "Trường Đại học Mẫu", major: "Kế toán", number: "MẪU-0001", issued_on: shift(today, 0, 0, -12) }),
        s(4, "insurance", "Thẻ bảo hiểm y tế của con (mẫu)", { number: "XX0 0000 0000 (mẫu)", provider: "Trạm y tế phường (mẫu)", expires_on: shift(today, 20) }, "Con (mẫu)"),
      ];
    case "documents":
      return [
        s(1, "contract", "Hợp đồng thuê nhà (mẫu)", { party: "Chủ nhà – cô Hoa (mẫu)", signed_on: shift(today, 0, -11), remember_on: shift(today, 25) }, "Tôi", "Hết hạn thì báo trước 30 ngày nếu muốn gia hạn."),
        s(2, "land", "Sổ đỏ căn hộ (mẫu)", { number: "AA 000000 (mẫu)", address: "Số 1 đường Mẫu, phường Ví Dụ", issued_on: shift(today, 0, 0, -3) }),
        s(3, "warranty", "Hoá đơn tủ lạnh · bảo hành (mẫu)", { seller: "Cửa hàng điện máy (mẫu)", bought_on: shift(today, 0, -7), remember_on: shift(today, 160) }),
        s(4, "medical", "Kết quả khám sức khoẻ (mẫu)", { place: "Phòng khám (mẫu)", visit_on: shift(today, -40), remember_on: shift(today, 12) }),
      ];
    case "assets":
      return [
        s(1, "property", "Căn hộ đang ở (mẫu)", { address: "Số 1 đường Mẫu, phường Ví Dụ", value: "2500000000", bought_on: shift(today, 0, 0, -3) }, "Tôi", "Sổ đỏ ở Tài liệu › Nhà đất."),
        s(2, "vehicle", "Xe máy (mẫu)", { plate: "29-X1 000.00 (mẫu)", value: "35000000" }, "Tôi", "Ô tô thì điền ngày đăng kiểm để được nhắc."),
        s(3, "gold", "Nhẫn cưới · vàng (mẫu)", { weight: "2 chỉ vàng 9999", value: "16000000", kept_at: "Hộp gỗ trong tủ (mẫu)" }, "Vợ/chồng (mẫu)"),
        s(4, "device", "Máy tính xách tay (mẫu)", { serial: "MAU-0000-0000", bought_on: shift(today, 0, -11), warranty_until: shift(today, 25) }),
      ];
    default:
      return [];
  }
}

/** The dismissed_guidance key that hides one compartment's samples (per account, every device). */
export function sampleHiddenKey(section: VaultSection | "finance"): "sample_hidden_finance" | "sample_hidden_passwords" | "sample_hidden_certificates" | "sample_hidden_documents" | "sample_hidden_assets" {
  return `sample_hidden_${section}` as ReturnType<typeof sampleHiddenKey>;
}
