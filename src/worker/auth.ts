// src/worker/auth.ts
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

// helper to set httpOnly cookie (adjust domain / secure for prod)
export function makeSetSessionCookie(token: string, maxAgeSec = 60 * 60 * 24 * 30) {
  // Secure depends on environment (set Secure in prod)
  const cookie = `session=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax`;
  return cookie;
}

export async function hashPassword(password: string) {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

export async function comparePassword(password: string, hash: string) {
  return bcrypt.compareSync(password, hash);
}

export function makeId() {
  return uuidv4();
}
