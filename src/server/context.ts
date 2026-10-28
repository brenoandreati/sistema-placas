/** Quem está executando a operação (para auditoria e autorização). */
export interface Actor {
  userId: string;
  ipAddress?: string | null;
}
