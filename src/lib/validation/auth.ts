import { z } from "zod";

/** Usuário (ex.: loja.placas): letras, números, ponto, hífen e sublinhado. */
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,63}$/;

// O login aceita e-mail ou nome de usuário; ambos ficam na coluna users.email (única).
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => USERNAME.test(v) || z.email().safeParse(v).success, "Informe o usuário ou e-mail."),
  password: z.string().min(1, "Informe a senha.").max(200),
});

export const passwordPolicy = z
  .string()
  .min(10, "A senha deve ter ao menos 10 caracteres.")
  .max(200, "Senha muito longa.")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Use letras e números na senha.");

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual."),
    newPassword: passwordPolicy,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não conferem.",
  });
