import bcrypt from "bcryptjs";

const COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Hash fixo usado para equalizar o tempo de resposta quando o usuário não existe. */
export const DUMMY_HASH = "$2b$12$8GwVDA9R5wUgj.isKNLkBuKOFyjKyIStfAsG8W7Nk/9U8c6fTupF.";
