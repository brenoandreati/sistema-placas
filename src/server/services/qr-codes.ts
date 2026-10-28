import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { QR_CODE_ALPHABET, QR_CODE_LENGTH } from "@/lib/qr";
import {
  createQrBatchSchema,
  updateQrCodeSchema,
  type CreateQrBatchInput,
  type UpdateQrCodeInput,
} from "@/lib/validation/qr-codes";
import type { Actor } from "@/server/context";
import { prisma, type Tx } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { pageArgs, paginated, type PageParams, type Paginated } from "@/server/pagination";
import { audit } from "./audit";

// QR codes dinâmicos: cada placa recebe um código fixo (impresso) e o destino é cadastrado/trocado aqui.
// O endereço público /q/{código} consulta o destino a cada leitura e redireciona.

/** Código aleatório com amostragem por rejeição (distribuição uniforme no alfabeto). */
function randomCode(): string {
  const limit = 256 - (256 % QR_CODE_ALPHABET.length);
  let code = "";
  while (code.length < QR_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(QR_CODE_LENGTH * 2))) {
      if (byte < limit && code.length < QR_CODE_LENGTH) code += QR_CODE_ALPHABET[byte % QR_CODE_ALPHABET.length];
    }
  }
  return code;
}

/** Gera `quantity` códigos inéditos (sem repetir entre si nem com os já existentes no banco). */
async function uniqueCodes(tx: Tx, quantity: number): Promise<string[]> {
  const codes = new Set<string>();
  while (codes.size < quantity) {
    const candidates = new Set<string>();
    while (candidates.size < quantity - codes.size) {
      const code = randomCode();
      if (!codes.has(code)) candidates.add(code);
    }
    const taken = await tx.qrCode.findMany({ where: { code: { in: [...candidates] } }, select: { code: true } });
    const takenSet = new Set(taken.map((t) => t.code));
    for (const code of candidates) if (!takenSet.has(code)) codes.add(code);
  }
  return [...codes];
}

export interface QrBatchView {
  id: string;
  number: number;
  quantity: number;
  notes: string | null;
  createdAt: string;
}

export async function createQrBatch(actor: Actor, input: CreateQrBatchInput): Promise<QrBatchView> {
  const data = createQrBatchSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const batch = await tx.qrCodeBatch.create({
      data: { quantity: data.quantity, notes: data.notes ?? null, createdById: actor.userId },
    });
    const codes = await uniqueCodes(tx, data.quantity);
    await tx.qrCode.createMany({
      data: codes.map((code, index) => ({ code, batchId: batch.id, position: index + 1 })),
    });
    await audit(tx, actor, {
      action: "qrcode.batch.create",
      entityType: "qr_code_batch",
      entityId: batch.id,
      summary: `Lote ${batch.number} com ${data.quantity} QR code(s) gerado`,
      metadata: { quantity: data.quantity, batchNumber: batch.number },
    });
    return {
      id: batch.id,
      number: batch.number,
      quantity: batch.quantity,
      notes: batch.notes,
      createdAt: batch.createdAt.toISOString(),
    };
  });
}

export interface QrCodeView {
  id: string;
  code: string;
  batchNumber: number;
  position: number;
  destinationUrl: string | null;
  customer: { id: string; businessName: string } | null;
  label: string | null;
  linkedAt: string | null;
  scanCount: number;
  lastScannedAt: string | null;
  createdAt: string;
}

const viewInclude = {
  batch: { select: { number: true } },
  customer: { select: { id: true, businessName: true } },
} satisfies Prisma.QrCodeInclude;

type QrCodeWithRelations = Prisma.QrCodeGetPayload<{ include: typeof viewInclude }>;

function toQrCodeView(q: QrCodeWithRelations): QrCodeView {
  return {
    id: q.id,
    code: q.code,
    batchNumber: q.batch.number,
    position: q.position,
    destinationUrl: q.destinationUrl,
    customer: q.customer,
    label: q.label,
    linkedAt: q.linkedAt?.toISOString() ?? null,
    scanCount: q.scanCount,
    lastScannedAt: q.lastScannedAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
  };
}

/** Cadastra, troca ou remove o link de destino (e o cliente/observação) de um QR code. */
export async function updateQrCode(actor: Actor, input: UpdateQrCodeInput): Promise<QrCodeView> {
  const data = updateQrCodeSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.qrCode.findUnique({ where: { code: data.code }, include: viewInclude });
    if (!before) throw new NotFoundError("QR code não encontrado.");
    if (data.customerId) {
      const customer = await tx.customer.findUnique({ where: { id: data.customerId }, select: { id: true } });
      if (!customer) throw new NotFoundError("Cliente não encontrado.");
    }
    const destinationUrl = data.destinationUrl ?? null;
    const destinationChanged = destinationUrl !== before.destinationUrl;
    const updated = await tx.qrCode.update({
      where: { id: before.id },
      data: {
        destinationUrl,
        customerId: data.customerId ?? null,
        label: data.label ?? null,
        ...(destinationChanged ? { linkedAt: destinationUrl ? new Date() : null } : {}),
      },
      include: viewInclude,
    });

    const beforeView = toQrCodeView(before);
    const afterView = toQrCodeView(updated);
    const tracked = {
      destinationUrl: (v: QrCodeView) => v.destinationUrl,
      customer: (v: QrCodeView) => v.customer?.businessName ?? null,
      label: (v: QrCodeView) => v.label,
    };
    const changed = (Object.keys(tracked) as (keyof typeof tracked)[]).filter(
      (k) => tracked[k](beforeView) !== tracked[k](afterView),
    );
    if (changed.length > 0) {
      const action = !destinationChanged
        ? "qrcode.update"
        : !destinationUrl
          ? "qrcode.unlink"
          : before.destinationUrl
            ? "qrcode.relink"
            : "qrcode.link";
      const summary = {
        "qrcode.update": `QR code ${updated.code} atualizado`,
        "qrcode.unlink": `Link do QR code ${updated.code} removido`,
        "qrcode.relink": `Link do QR code ${updated.code} trocado`,
        "qrcode.link": `QR code ${updated.code} ativado`,
      }[action];
      await audit(tx, actor, {
        action,
        entityType: "qr_code",
        entityId: updated.id,
        summary: afterView.customer ? `${summary} (${afterView.customer.businessName})` : summary,
        before: Object.fromEntries(changed.map((k) => [k, tracked[k](beforeView)])),
        after: Object.fromEntries(changed.map((k) => [k, tracked[k](afterView)])),
      });
    }
    return afterView;
  });
}

/**
 * Leitura pública do QR code: devolve o destino e contabiliza a leitura em uma única ida ao banco.
 * Nulo quando o código não existe ou ainda não tem link.
 */
export async function resolveQrCode(code: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ destination_url: string }[]>`
    UPDATE qr_codes
       SET scan_count = scan_count + 1, last_scanned_at = now()
     WHERE code = ${code} AND destination_url IS NOT NULL
 RETURNING destination_url`;
  return rows[0]?.destination_url ?? null;
}

// ───────────────────────── Consultas ─────────────────────────

export async function getQrCode(code: string): Promise<QrCodeView | null> {
  const qr = await prisma.qrCode.findUnique({ where: { code }, include: viewInclude });
  return qr ? toQrCodeView(qr) : null;
}

export interface QrCodeFilters extends PageParams {
  search?: string;
  status?: "all" | "linked" | "free";
  batchNumber?: number;
}

export async function listQrCodes(filters: QrCodeFilters): Promise<Paginated<QrCodeView>> {
  const { page, pageSize, skip, take } = pageArgs(filters);
  const and: Prisma.QrCodeWhereInput[] = [];
  if (filters.status === "linked") and.push({ destinationUrl: { not: null } });
  if (filters.status === "free") and.push({ destinationUrl: null });
  if (filters.batchNumber) and.push({ batch: { number: filters.batchNumber } });
  const search = filters.search?.trim();
  if (search) {
    and.push({
      OR: [
        { code: { contains: search.toUpperCase() } },
        { label: { contains: search, mode: "insensitive" } },
        { destinationUrl: { contains: search, mode: "insensitive" } },
        { customer: { businessName: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.QrCodeWhereInput = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.qrCode.findMany({
      where,
      include: viewInclude,
      orderBy: [{ batch: { number: "desc" } }, { position: "asc" }],
      skip,
      take,
    }),
    prisma.qrCode.count({ where }),
  ]);
  return paginated(rows.map(toQrCodeView), total, page, pageSize);
}

export interface QrOverview {
  total: number;
  linked: number;
  free: number;
  scans: number;
  batches: (QrBatchView & { linked: number })[];
}

export async function getQrOverview(): Promise<QrOverview> {
  const [totals, linkedByBatch, batches] = await Promise.all([
    prisma.qrCode.aggregate({ _count: { _all: true, destinationUrl: true }, _sum: { scanCount: true } }),
    prisma.qrCode.groupBy({ by: ["batchId"], where: { destinationUrl: { not: null } }, _count: { _all: true } }),
    prisma.qrCodeBatch.findMany({ orderBy: { number: "desc" } }),
  ]);
  const linkedMap = new Map(linkedByBatch.map((b) => [b.batchId, b._count._all]));
  const total = totals._count._all;
  const linked = totals._count.destinationUrl;
  return {
    total,
    linked,
    free: total - linked,
    scans: totals._sum.scanCount ?? 0,
    batches: batches.map((b) => ({
      id: b.id,
      number: b.number,
      quantity: b.quantity,
      notes: b.notes,
      createdAt: b.createdAt.toISOString(),
      linked: linkedMap.get(b.id) ?? 0,
    })),
  };
}

/** Códigos para a folha de impressão: um lote inteiro ou um código avulso, na ordem do lote. */
export async function getQrCodesForPrint(
  selection: { batchNumber: number } | { code: string },
): Promise<{ code: string; batchNumber: number; position: number }[]> {
  const rows = await prisma.qrCode.findMany({
    where: "code" in selection ? { code: selection.code } : { batch: { number: selection.batchNumber } },
    select: { code: true, position: true, batch: { select: { number: true } } },
    orderBy: { position: "asc" },
  });
  return rows.map((r) => ({ code: r.code, position: r.position, batchNumber: r.batch.number }));
}

export async function listCustomerQrCodes(customerId: string): Promise<QrCodeView[]> {
  const rows = await prisma.qrCode.findMany({
    where: { customerId },
    include: viewInclude,
    orderBy: [{ batch: { number: "asc" } }, { position: "asc" }],
  });
  return rows.map(toQrCodeView);
}

/** Clientes ativos para o seletor do formulário (com o link de avaliações para preencher o destino). */
export async function listQrCustomerOptions() {
  return prisma.customer.findMany({
    where: { active: true },
    orderBy: { businessName: "asc" },
    take: 500,
    select: { id: true, businessName: true, contactName: true, phone: true, googleReviewUrl: true },
  });
}
