import crypto from "node:crypto";

// 사용자가 입력한 넥슨 오픈 API 개인 키를 DB에 평문으로 두지 않기 위한
// 대칭 암호화. NEXON_KEY_ENCRYPTION_SECRET은 서버 환경변수로만 존재하고,
// 클라이언트 번들에는 절대 노출되지 않는다 (이 파일은 route handler /
// server action에서만 import 됨).
function getKey(): Buffer {
  const secret = process.env.NEXON_KEY_ENCRYPTION_SECRET;
  if (!secret) throw new Error("NEXON_KEY_ENCRYPTION_SECRET 환경변수가 설정되지 않았어요.");
  // base64 32바이트를 기대하지만, 길이가 다르면 sha256으로 늘려서라도 동작은 하게 함.
  const raw = Buffer.from(secret, "base64");
  return raw.length === 32 ? raw : crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv.tag.ciphertext 를 base64로 이어 붙여 하나의 문자열로 저장
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, encB64] = stored.split(".");
  const key = getKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]);
  return dec.toString("utf8");
}
