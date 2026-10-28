// QR codes dinâmicos: geração em lote, cadastro/troca de link, leitura pública e endereço impresso.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { QR_CODE_ALPHABET, QR_CODE_LENGTH, normalizeQrCode, qrPublicUrl } from "@/lib/qr";
import { drawQr } from "@/lib/qr-svg";
import type { Actor } from "@/server/context";
import { disconnectDb, prisma } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { deleteCustomer } from "@/server/services/customers";
import {
  createQrBatch,
  getQrCode,
  getQrCodesForPrint,
  getQrOverview,
  listCustomerQrCodes,
  listQrCodes,
  resolveQrCode,
  updateQrCode,
} from "@/server/services/qr-codes";
import { getSettingsView, updateQrBaseUrl } from "@/server/services/settings";
import { makeCustomer, resetDatabase } from "./helpers";

let actor: Actor;

beforeEach(async () => {
  actor = await resetDatabase();
});

afterAll(async () => {
  await disconnectDb();
});

const REVIEW_URL = "https://g.page/r/padaria-pao-dourado/review";

async function firstCode(batchNumber: number): Promise<string> {
  const [first] = await getQrCodesForPrint({ batchNumber });
  return first.code;
}

describe("códigos", () => {
  it("normaliza o código lido da URL ou digitado", () => {
    expect(normalizeQrCode(" k7p2qx ")).toBe("K7P2QX");
    expect(normalizeQrCode("ABC")).toBeNull();
    expect(normalizeQrCode("K7P2Q-X")).toBeNull();
    expect(normalizeQrCode(undefined)).toBeNull();
    expect(qrPublicUrl("https://suaplaca.com.br/", "K7P2QX")).toBe("https://suaplaca.com.br/q/K7P2QX");
  });

  it("desenha um QR code quadrado com os módulos escuros em um único path", () => {
    const { size, path } = drawQr("https://suaplaca.com.br/q/K7P2QX", 2);
    expect(size).toBeGreaterThanOrEqual(21 + 4);
    expect(path).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
  });
});

describe("lotes", () => {
  it("gera códigos únicos, na ordem de impressão e com auditoria", async () => {
    const batch = await createQrBatch(actor, { quantity: 120, notes: "Placas de acrílico" });
    expect(batch.number).toBe(1);
    const codes = await getQrCodesForPrint({ batchNumber: 1 });
    expect(codes).toHaveLength(120);
    expect(codes.map((c) => c.position)).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    expect(new Set(codes.map((c) => c.code)).size).toBe(120);
    for (const { code } of codes) {
      expect(code).toHaveLength(QR_CODE_LENGTH);
      expect([...code].every((ch) => QR_CODE_ALPHABET.includes(ch))).toBe(true);
    }
    const second = await createQrBatch(actor, { quantity: 5 });
    expect(second.number).toBe(2);
    const all = await prisma.qrCode.findMany({ select: { code: true } });
    expect(new Set(all.map((c) => c.code)).size).toBe(125);

    const logs = await prisma.auditLog.findMany({ where: { action: "qrcode.batch.create" } });
    expect(logs).toHaveLength(2);
  });

  it("recusa quantidade fora do limite", async () => {
    await expect(createQrBatch(actor, { quantity: 0 })).rejects.toBeInstanceOf(ZodError);
    await expect(createQrBatch(actor, { quantity: 501 })).rejects.toBeInstanceOf(ZodError);
    expect(await prisma.qrCodeBatch.count()).toBe(0);
  });
});

describe("links", () => {
  it("cadastra, troca e remove o link de destino, registrando cada passo", async () => {
    await createQrBatch(actor, { quantity: 3 });
    const code = await firstCode(1);

    const linked = await updateQrCode(actor, { code: code.toLowerCase(), destinationUrl: REVIEW_URL, label: "Balcão" });
    expect(linked.destinationUrl).toBe(REVIEW_URL);
    expect(linked.linkedAt).not.toBeNull();
    expect(linked.label).toBe("Balcão");

    const relinked = await updateQrCode(actor, { code, destinationUrl: "https://instagram.com/padaria" });
    expect(relinked.destinationUrl).toBe("https://instagram.com/padaria");
    expect(relinked.label).toBeNull();

    const unlinked = await updateQrCode(actor, { code, destinationUrl: "" });
    expect(unlinked.destinationUrl).toBeNull();
    expect(unlinked.linkedAt).toBeNull();

    const actions = (
      await prisma.auditLog.findMany({ where: { entityType: "qr_code" }, orderBy: { createdAt: "asc" } })
    ).map((l) => l.action);
    expect(actions).toEqual(["qrcode.link", "qrcode.relink", "qrcode.unlink"]);
  });

  it("não grava auditoria quando nada mudou", async () => {
    await createQrBatch(actor, { quantity: 1 });
    const code = await firstCode(1);
    await updateQrCode(actor, { code, destinationUrl: REVIEW_URL });
    await updateQrCode(actor, { code, destinationUrl: REVIEW_URL });
    expect(await prisma.auditLog.count({ where: { entityType: "qr_code" } })).toBe(1);
  });

  it("aceita só links web e recusa códigos e clientes inexistentes", async () => {
    await createQrBatch(actor, { quantity: 1 });
    const code = await firstCode(1);
    await expect(updateQrCode(actor, { code, destinationUrl: "javascript:alert(1)" })).rejects.toBeInstanceOf(ZodError);
    await expect(updateQrCode(actor, { code, destinationUrl: "g.page/review" })).rejects.toBeInstanceOf(ZodError);
    await expect(updateQrCode(actor, { code: "ZZZZZZ", destinationUrl: REVIEW_URL })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      updateQrCode(actor, { code, destinationUrl: REVIEW_URL, customerId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // O banco também barra destinos que não sejam http(s).
    await expect(
      prisma.qrCode.update({ where: { code }, data: { destinationUrl: "javascript:alert(1)" } }),
    ).rejects.toThrow();
  });

  it("vincula ao cliente e mantém o link se o cliente for excluído", async () => {
    await createQrBatch(actor, { quantity: 2 });
    const code = await firstCode(1);
    const customer = await makeCustomer(actor);
    await updateQrCode(actor, { code, destinationUrl: REVIEW_URL, customerId: customer.id });
    expect((await listCustomerQrCodes(customer.id)).map((q) => q.code)).toEqual([code]);

    await deleteCustomer(actor, customer.id);
    const qr = await getQrCode(code);
    expect(qr?.customer).toBeNull();
    expect(qr?.destinationUrl).toBe(REVIEW_URL);
  });
});

describe("leitura pública", () => {
  it("redireciona só QR codes com link e conta cada leitura", async () => {
    await createQrBatch(actor, { quantity: 2 });
    const code = await firstCode(1);

    expect(await resolveQrCode(code)).toBeNull();
    expect(await resolveQrCode("ZZZZZZ")).toBeNull();
    expect((await getQrCode(code))?.scanCount).toBe(0);

    await updateQrCode(actor, { code, destinationUrl: REVIEW_URL });
    expect(await resolveQrCode(code)).toBe(REVIEW_URL);
    await Promise.all([resolveQrCode(code), resolveQrCode(code), resolveQrCode(code)]);
    const qr = await getQrCode(code);
    expect(qr?.scanCount).toBe(4);
    expect(qr?.lastScannedAt).not.toBeNull();

    // Trocar o link vale na próxima leitura, sem reimprimir.
    await updateQrCode(actor, { code, destinationUrl: "https://instagram.com/padaria" });
    expect(await resolveQrCode(code)).toBe("https://instagram.com/padaria");
  });
});

describe("consultas", () => {
  it("filtra por situação, lote e busca e resume o uso", async () => {
    await createQrBatch(actor, { quantity: 4 });
    await createQrBatch(actor, { quantity: 3 });
    const customer = await makeCustomer(actor, "Barbearia Navalha");
    const [a, b] = await getQrCodesForPrint({ batchNumber: 1 });
    await updateQrCode(actor, { code: a.code, destinationUrl: REVIEW_URL, customerId: customer.id });
    await updateQrCode(actor, { code: b.code, destinationUrl: "https://instagram.com/navalha", label: "Espelho" });
    await resolveQrCode(a.code);

    expect((await listQrCodes({ status: "linked" })).total).toBe(2);
    expect((await listQrCodes({ status: "free" })).total).toBe(5);
    expect((await listQrCodes({ batchNumber: 2 })).total).toBe(3);
    expect((await listQrCodes({ search: "navalha" })).items.map((q) => q.code).sort()).toEqual([a.code, b.code].sort());
    expect((await listQrCodes({ search: "espelho" })).items.map((q) => q.code)).toEqual([b.code]);
    expect((await listQrCodes({ search: a.code.toLowerCase() })).items.map((q) => q.code)).toEqual([a.code]);

    const overview = await getQrOverview();
    expect(overview).toMatchObject({ total: 7, linked: 2, free: 5, scans: 1 });
    expect(overview.batches.map((x) => [x.number, x.quantity, x.linked])).toEqual([
      [2, 3, 0],
      [1, 4, 2],
    ]);
  });
});

describe("endereço impresso", () => {
  it("guarda só o domínio e recusa caminhos", async () => {
    await updateQrBaseUrl(actor, { qrBaseUrl: "https://SuaPlaca.com.br/" });
    expect((await getSettingsView()).qrBaseUrl).toBe("https://suaplaca.com.br");
    await expect(updateQrBaseUrl(actor, { qrBaseUrl: "https://suaplaca.com.br/placas" })).rejects.toBeInstanceOf(
      ZodError,
    );
    await updateQrBaseUrl(actor, { qrBaseUrl: "" });
    expect((await getSettingsView()).qrBaseUrl).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "settings.update" } })).toBe(2);
  });
});
