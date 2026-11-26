/**
 * Base64 VLQ encoding for source-map v3 `mappings` (zero dependencies).
 *
 * Source maps encode every number as a signed variable-length quantity in
 * base64 digits: the low bit of the first digit is the sign, the remaining bits
 * are the magnitude in five-bit groups, and the continuation bit (`0x20`) marks
 * every group but the last. All values here are integers within JavaScript's
 * safe range, which is far beyond the line/column deltas a stylesheet produces.
 */

/** Standard source-map base64 alphabet (`A`=0 … `9`=61, `+`=62, `/`=63). */
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encode one signed integer as a base64 VLQ segment value. */
export function encodeVlq(value: number): string {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new RangeError(`VLQ values must be finite integers, received ${String(value)}.`);
  }
  // Negative numbers use the low bit as the sign and the magnitude shifted left.
  let remaining = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = "";
  do {
    let digit = remaining & 0x1f;
    remaining >>>= 5;
    if (remaining > 0) digit |= 0x20;
    encoded += BASE64.charAt(digit);
  } while (remaining > 0);
  return encoded;
}
