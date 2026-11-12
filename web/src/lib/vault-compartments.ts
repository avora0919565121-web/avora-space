/**
 * KT-06 · D (CEO 12/11 23:36): an encrypted compartment opened before any code is set says what it is for
 * and invites the first thing in — never an empty room. SP-04's sample list will sit right under it.
 */
export const COMPARTMENT_INTRO: Record<"mat-khau" | "chung-chi" | "tai-lieu" | "tai-san", { noun: string; purpose: string }> = {
  "mat-khau": { noun: "mật khẩu", purpose: "Nơi cất mật khẩu ngân hàng, email, Wi-Fi, mã khoá cửa… để không phải nhớ hết trong đầu." },
  "chung-chi": { noun: "chứng chỉ", purpose: "Nơi cất bằng cấp, chứng chỉ, giấy phép của cả nhà, có nhắc trước ngày hết hạn." },
  "tai-lieu": { noun: "giấy tờ", purpose: "Nơi cất bản chụp căn cước, hộ chiếu, hợp đồng, sổ đỏ… để cần là có ngay." },
  "tai-san": { noun: "tài sản", purpose: "Nơi ghi nhà, xe, vàng, bảo hiểm… cùng giấy tờ đi kèm, để cả nhà biết của cải nằm ở đâu." },
};
export type CompartmentKey = keyof typeof COMPARTMENT_INTRO;

export function compartmentOf(pathname: string): CompartmentKey | null {
  const key = /^\/ket-sat\/(mat-khau|chung-chi|tai-lieu|tai-san)\/?$/.exec(pathname)?.[1];
  return key === undefined ? null : (key as CompartmentKey);
}
