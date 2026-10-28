"use server";

import type { CreateQrBatchInput, QrBaseUrlInput, UpdateQrCodeInput } from "@/lib/validation/qr-codes";
import { requireActor } from "@/server/auth/guard";
import { createQrBatch, listQrCustomerOptions, updateQrCode } from "@/server/services/qr-codes";
import { updateQrBaseUrl } from "@/server/services/settings";
import { runAction } from "./run";

export async function createQrBatchAction(input: CreateQrBatchInput) {
  return runAction("qrcodes.write", async (actor) => {
    const batch = await createQrBatch(actor, input);
    return { number: batch.number, quantity: batch.quantity };
  });
}

export async function updateQrCodeAction(input: UpdateQrCodeInput) {
  return runAction("qrcodes.write", async (actor) => {
    const qr = await updateQrCode(actor, input);
    return { code: qr.code, destinationUrl: qr.destinationUrl };
  });
}

export async function updateQrBaseUrlAction(input: QrBaseUrlInput) {
  return runAction(
    "settings.write",
    async (actor) => {
      const settings = await updateQrBaseUrl(actor, input);
      return { qrBaseUrl: settings.qrBaseUrl };
    },
    { message: "Endereço dos QR codes salvo." },
  );
}

/** Clientes para vincular a um QR code (com o link de avaliações, para preencher o destino). */
export async function getQrFormCustomersAction() {
  await requireActor("qrcodes.write");
  return listQrCustomerOptions();
}
