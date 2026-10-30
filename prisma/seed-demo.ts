// Dados de DEMONSTRAÇÃO — somente para um banco separado (ex.: placas_demo).
// Nunca misture com os dados reais: o script recusa bancos cujo nome não termine em "_demo"
// e bancos que já tenham vendas.
//
// Uso: DEMO_DATABASE_URL=postgresql://placas:placas@localhost:5432/placas_demo npm run db:demo
// (as migrations são aplicadas automaticamente no banco de demonstração)
import "dotenv/config";
import { execSync } from "node:child_process";

const demoUrl = process.env.DEMO_DATABASE_URL;
if (!demoUrl) {
  console.error(
    "✖ Defina DEMO_DATABASE_URL apontando para um banco exclusivo de demonstração (nome terminando em _demo).",
  );
  process.exit(1);
}
const dbName = new URL(demoUrl).pathname.replace(/^\//, "");
if (!dbName.endsWith("_demo")) {
  console.error(`✖ Recusado: o banco "${dbName}" não parece ser de demonstração (o nome deve terminar em _demo).`);
  process.exit(1);
}
if (demoUrl === process.env.DATABASE_URL) {
  console.error("✖ Recusado: DEMO_DATABASE_URL é igual a DATABASE_URL.");
  process.exit(1);
}

// Os serviços leem DATABASE_URL: a partir daqui tudo acontece no banco de demonstração.
process.env.DATABASE_URL = demoUrl;

async function main() {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, MIGRATION_DATABASE_URL: demoUrl } });

  const { prisma, disconnectDb } = await import("../src/server/db");
  const { ensureReferenceData } = await import("../src/server/reference-data");
  const { hashPassword } = await import("../src/server/auth/password");
  const { toLocalDateTimeInput, DEFAULT_TIMEZONE } = await import("../src/lib/dates");
  const { getDefaultCashAccount } = await import("../src/server/services/cash");
  const { setOpeningBalance, registerExpense, registerIncome } = await import("../src/server/services/finance");
  const { createProduct, registerStockEntry, adjustStock } = await import("../src/server/services/inventory");
  const { createCustomer } = await import("../src/server/services/customers");
  const { createSale, registerPayment, cancelSale } = await import("../src/server/services/sales");
  const { registerWithdrawal } = await import("../src/server/services/withdrawals");
  const { createQrBatch, getQrCodesForPrint, updateQrCode } = await import("../src/server/services/qr-codes");
  const { createFollowUp, recordFollowUpResult } = await import("../src/server/services/follow-ups");
  const { addDaysToDate, todayString } = await import("../src/lib/dates");

  try {
    if ((await prisma.sale.count()) > 0) {
      console.error("✖ O banco de demonstração já possui vendas. Recrie-o vazio para gerar os dados novamente.");
      process.exit(1);
    }
    await ensureReferenceData(prisma);
    const email = "demo@placas.local";
    const user =
      (await prisma.user.findUnique({ where: { email } })) ??
      (await prisma.user.create({
        data: { email, name: "Conta demonstração", role: "ADMIN", passwordHash: await hashPassword("Demo@123456") },
      }));
    const actor = { userId: user.id };
    const tz = DEFAULT_TIMEZONE;

    // Gerador determinístico (os dados são sempre os mesmos).
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
    const daysAgo = (days: number, hour = 10 + Math.floor(rand() * 8)) => {
      const d = new Date(Date.now() - days * 86_400_000);
      d.setUTCHours(hour + 3, Math.floor(rand() * 60), 0, 0);
      return toLocalDateTimeInput(d, tz);
    };
    const method = async (name: string) => (await prisma.paymentMethod.findUniqueOrThrow({ where: { name } })).id;
    const category = async (name: string) => (await prisma.financialCategory.findFirstOrThrow({ where: { name } })).id;

    await prisma.settings.update({
      where: { id: 1 },
      data: { businessName: "Toque Avaliações (DEMO)", displayName: "Placas NFC · Demo", setupCompletedAt: new Date() },
    });
    const account = await getDefaultCashAccount();
    await setOpeningBalance(actor, {
      cashAccountId: account.id,
      amountCents: 200_000,
      date: daysAgo(120).slice(0, 10),
      reason: "Implantação da demonstração",
    });

    const product = await createProduct(actor, {
      name: "Placa NFC Avaliações Google",
      sku: "NFC-GOOGLE",
      description: "Placa em acrílico com chip NFC e QR Code para a página de avaliações.",
      category: "Placas NFC",
      salePriceCents: 8900,
      minStock: 15,
      active: true,
      initialQuantity: 0,
    });
    const premium = await createProduct(actor, {
      name: "Placa NFC Premium (aço escovado)",
      sku: "NFC-PREMIUM",
      category: "Placas NFC",
      salePriceCents: 14900,
      minStock: 5,
      active: true,
      initialQuantity: 0,
    });
    await registerStockEntry(actor, {
      productId: product.id,
      quantity: 120,
      unitCostCents: 2150,
      entryDate: daysAgo(118),
      supplier: "Gráfica Acrílicos SP",
      documentNumber: "NF 1182",
      paidNow: true,
      paymentMethodId: await method("PIX"),
    });
    await registerStockEntry(actor, {
      productId: premium.id,
      quantity: 30,
      unitCostCents: 5200,
      entryDate: daysAgo(110),
      supplier: "Metalúrgica Inox",
      paidNow: true,
      paymentMethodId: await method("Transferência bancária"),
    });
    await registerStockEntry(actor, {
      productId: product.id,
      quantity: 80,
      unitCostCents: 2300,
      entryDate: daysAgo(45),
      supplier: "Gráfica Acrílicos SP",
      documentNumber: "NF 1440",
      paidNow: true,
      paymentMethodId: await method("PIX"),
    });

    const businesses = [
      ["Padaria Pão Dourado", "Maria Souza", "Padaria", "São Paulo", "SP"],
      ["Barbearia Navalha de Ouro", "João Lima", "Barbearia", "Campinas", "SP"],
      ["Restaurante Sabor da Serra", "Ana Ribeiro", "Restaurante", "Belo Horizonte", "MG"],
      ["Clínica Sorriso Leve", "Dr. Paulo Mendes", "Consultório odontológico", "Curitiba", "PR"],
      ["Pet Shop Amigo Fiel", "Carla Nunes", "Pet shop", "Santos", "SP"],
      ["Academia Movimento", "Rafael Costa", "Academia", "Rio de Janeiro", "RJ"],
      ["Café Grão Nobre", "Juliana Prado", "Cafeteria", "Porto Alegre", "RS"],
      ["Studio Bela Pele", "Fernanda Alves", "Salão de beleza", "Goiânia", "GO"],
      ["Oficina Motor Certo", "Marcos Pereira", "Oficina mecânica", "Sorocaba", "SP"],
      ["Pousada Vento Leste", "Beatriz Rocha", "Hotel / Pousada", "Florianópolis", "SC"],
      ["Hamburgueria Brasa", "Thiago Martins", "Restaurante", "São Paulo", "SP"],
      ["Ótica Visão Clara", "Patrícia Gomes", "Loja de varejo", "Recife", "PE"],
      ["Sorveteria Gelato Mio", "Lucas Ferreira", "Cafeteria", "Fortaleza", "CE"],
      ["Imobiliária Chave Certa", "Renata Dias", "Imobiliária", "Brasília", "DF"],
      ["Bar do Alemão", "Klaus Becker", "Bar", "Blumenau", "SC"],
    ];
    const customers = [];
    for (const [i, [businessName, contactName, segment, city, state]] of businesses.entries()) {
      const phone = `119${String(87000000 + i * 13579).padStart(8, "0")}`;
      customers.push(
        await createCustomer(actor, {
          businessName,
          contactName,
          segment,
          city,
          state,
          phone,
          whatsapp: phone,
          email: `contato${i + 1}@exemplo-demo.com.br`,
          publicPlaceName: businessName,
          googleReviewUrl: i % 3 === 0 ? `https://g.page/r/exemplo-demo-${i + 1}/review` : undefined,
          plateCustomizationNotes: i % 4 === 0 ? "Logo do cliente em branco, fundo preto." : undefined,
        }),
      );
    }

    const methods = [await method("PIX"), await method("PIX"), await method("Cartão"), await method("Dinheiro")];
    const sales = [];
    for (let i = 0; i < 46; i++) {
      const day = Math.floor(100 - i * 2.1 - rand() * 2);
      const isPremium = rand() < 0.18;
      const target = isPremium ? premium : product;
      const quantity = 1 + Math.floor(rand() * (isPremium ? 2 : 4));
      const roll = rand();
      const status =
        day > 20
          ? roll < 0.82
            ? "PAID"
            : roll < 0.92
              ? "PARTIAL"
              : "PENDING"
          : roll < 0.55
            ? "PAID"
            : roll < 0.75
              ? "PARTIAL"
              : "PENDING";
      const price = Math.round(target.salePrice * 100);
      const total = quantity * price;
      try {
        const sale = await createSale(actor, {
          customerId: pick(customers).id,
          items: [{ productId: target.id, quantity, unitPriceCents: price }],
          saleDate: daysAgo(Math.max(day, 0)),
          paymentMethodId: pick(methods),
          paymentStatus: status as "PAID" | "PARTIAL" | "PENDING",
          amountReceivedCents: status === "PARTIAL" ? Math.round(total * 0.5) : undefined,
          discountCents: rand() < 0.15 ? 1000 : 0,
          shippingCents: rand() < 0.3 ? 1800 : 0,
          status: day > 10 ? "DELIVERED" : day > 4 ? "SHIPPED" : "PREPARING",
        });
        sales.push({ sale, day });
      } catch (error) {
        console.warn("Venda ignorada:", error instanceof Error ? error.message : error);
      }
    }

    // Alguns clientes quitam depois.
    for (const { sale, day } of sales.filter((s) => s.sale.paymentStatus !== "PAID" && s.day > 25).slice(0, 4)) {
      const fresh = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
      const pending = Math.round((Number(fresh.total) - Number(fresh.amountPaid)) * 100);
      await registerPayment(actor, {
        saleId: sale.id,
        amountCents: pending,
        paymentMethodId: await method("PIX"),
        paidAt: daysAgo(day - 8),
      });
    }

    // Um cancelamento com devolução ao estoque.
    const toCancel = sales.find((s) => s.day > 30 && s.day < 60);
    if (toCancel) {
      const items = await prisma.saleItem.findMany({ where: { saleId: toCancel.sale.id } });
      await cancelSale(actor, {
        saleId: toCancel.sale.id,
        reason: "Cliente fechou o estabelecimento antes da instalação",
        returns: items.map((i) => ({ saleItemId: i.id, returnQuantity: i.quantity })),
        refundMode: "REFUND_NOW",
      });
    }

    await adjustStock(actor, {
      productId: product.id,
      direction: "OUT",
      quantity: 2,
      reason: "Placas trincadas no transporte",
      occurredAt: daysAgo(40),
    });

    for (const [days, cents, cat, desc] of [
      [95, 4500, "Frete", "Envio de placas (Correios)"],
      [80, 3200, "Embalagens", "Envelopes e plástico bolha"],
      [70, 25000, "Publicidade", "Anúncios no Instagram"],
      [50, 4800, "Frete", "Envio de placas (Correios)"],
      [35, 1990, "Taxas de pagamento", "Taxa da maquininha"],
      [20, 25000, "Publicidade", "Anúncios no Instagram"],
      [8, 3600, "Embalagens", "Caixas personalizadas"],
    ] as const) {
      await registerExpense(actor, {
        amountCents: cents,
        incurredAt: daysAgo(days),
        categoryId: await category(cat),
        description: desc,
        paymentMethodId: await method("PIX"),
      });
    }
    await registerIncome(actor, {
      kind: "CAPITAL_CONTRIBUTION",
      amountCents: 50000,
      occurredAt: daysAgo(60),
      categoryId: await category("Aporte de capital"),
      description: "Aporte para compra de estoque",
    });
    for (const [days, cents, cat, desc] of [
      [62, 60000, "Retirada pessoal do proprietário", "Pró-labore"],
      [31, 60000, "Retirada pessoal do proprietário", "Pró-labore"],
      [3, 40000, "Distribuição de lucros", "Distribuição do trimestre"],
    ] as const) {
      await registerWithdrawal(actor, {
        amountCents: cents,
        withdrawnAt: daysAgo(days),
        paymentMethodId: await method("Transferência bancária"),
        categoryId: await category(cat),
        description: desc,
      });
    }

    // Um lote de QR codes: os primeiros já vinculados aos clientes, o restante livre para ativar.
    await createQrBatch(actor, { quantity: 30, notes: "Adesivos para placas de acrílico" });
    const qrCodes = await getQrCodesForPrint({ batchNumber: 1 });
    for (const [i, customer] of customers.slice(0, 8).entries()) {
      await updateQrCode(actor, {
        code: qrCodes[i].code,
        customerId: customer.id,
        destinationUrl: customer.googleReviewUrl ?? `https://instagram.com/exemplo-demo-${i + 1}`,
        label: i % 2 === 0 ? "Balcão" : undefined,
      });
    }

    // Agenda de retornos: um atrasado, dois para hoje, próximos, um potencial cliente e um contato já resolvido.
    const today = todayString(tz);
    const followUps: [number, number, string | undefined, "VISIT" | "CALL" | "WHATSAPP" | "PROPOSAL", string][] = [
      [9, -2, "15:00", "VISIT", "Cliente demonstrou interesse, mas pediu para retornar depois"],
      [10, 0, "09:30", "VISIT", "Cliente precisa conversar com sócio ou responsável"],
      [11, 0, "16:00", "WHATSAPP", "Cliente pediu mais informações"],
      [12, 2, undefined, "PROPOSAL", "Cliente quer analisar a proposta"],
      [13, 6, "10:00", "CALL", "Cliente solicitou um prazo para decidir"],
    ];
    for (const [index, days, time, type, reason] of followUps) {
      await createFollowUp(actor, {
        customerMode: "existing",
        customerId: customers[index].id,
        date: addDaysToDate(today, days),
        time,
        type,
        reason,
      });
    }
    await createFollowUp(actor, {
      customerMode: "new",
      businessName: "Floricultura Jardim Secreto",
      contactName: "Cláudia Ramos",
      phone: "27998001122",
      date: addDaysToDate(today, 1),
      time: "11:00",
      type: "VISIT",
      reason: "Cliente demonstrou interesse, mas pediu para retornar depois",
      notes: "Levar a placa de acrílico de amostra.",
    });
    const visited = await createFollowUp(actor, {
      customerMode: "existing",
      customerId: customers[14].id,
      date: addDaysToDate(today, -1),
      time: "14:00",
      type: "VISIT",
      reason: "Cliente pediu para entrar em contato novamente",
    });
    await recordFollowUpResult(actor, {
      id: visited.id,
      status: "DONE",
      outcome: "Gostou da placa, mas pediu para retornar na próxima terça-feira para fechar.",
    });

    console.log(`✔ Demonstração pronta em "${dbName}": ${sales.length} vendas, ${customers.length} clientes.`);
    console.log("  Para usar: DATABASE_URL=<DEMO_DATABASE_URL> npm run dev  ·  login demo@placas.local / Demo@123456");
  } finally {
    await disconnectDb();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
