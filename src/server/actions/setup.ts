"use server";

import type { SetupInput } from "@/lib/validation/finance";
import { completeInitialSetup, skipInitialSetup } from "@/server/services/setup";
import { runAction } from "./run";

export async function completeSetupAction(input: SetupInput) {
  return runAction("settings.write", async (actor) => {
    await completeInitialSetup(actor, input);
    return undefined;
  }, { message: "Tudo pronto! Seu painel está configurado." });
}

export async function skipSetupAction() {
  return runAction("settings.write", async (actor) => {
    await skipInitialSetup(actor);
    return undefined;
  });
}
