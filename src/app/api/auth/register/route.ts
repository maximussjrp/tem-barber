import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { consumeRateLimit, resolveClientIp } from "@/lib/public-rate-limit";

// Helper para gerar o slug do estabelecimento
function slugify(text: string) {
  return text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/--+/g, "-")
    .trim();
}

// Helper para validar CPF
function isValidCpf(cpf: string) {
  const cleanCpf = cpf.replace(/\D/g, "");
  if (cleanCpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cleanCpf)) return false;

  let sum = 0;
  let remainder;

  for (let i = 1; i <= 9; i++) {
    sum += parseInt(cleanCpf.substring(i - 1, i)) * (11 - i);
  }

  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleanCpf.substring(9, 10))) return false;

  sum = 0;
  for (let i = 1; i <= 10; i++) {
    sum += parseInt(cleanCpf.substring(i - 1, i)) * (12 - i);
  }

  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleanCpf.substring(10, 11))) return false;

  return true;
}

export async function POST(request: Request) {
  try {
    const ip = resolveClientIp(request);
    const rateLimit = consumeRateLimit({
      bucket: "public-barbershop-register",
      key: ip,
      max: 5,
      windowMs: 15 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Muitas tentativas de cadastro. Tente novamente em alguns minutos." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    const body = await request.json();
    const { name, email, phone, cpf, password, barbershopName } = body;

    // 1. Validações de campos obrigatórios
    if (
      !name?.trim() ||
      !email?.trim() ||
      !phone?.trim() ||
      !cpf?.trim() ||
      !password ||
      !barbershopName?.trim()
    ) {
      return NextResponse.json(
        { error: "Todos os campos são obrigatórios para o cadastro da barbearia." },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "A senha deve ter no mínimo 6 caracteres." },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { error: "E-mail em formato inválido." },
        { status: 400 }
      );
    }

    // 2. Higienizar dados
    const cleanCpf = cpf.replace(/\D/g, "");
    const cleanPhone = phone.replace(/\D/g, "");
    const cleanEmail = email.trim().toLowerCase();

    // 3. Validação de CPF
    if (!isValidCpf(cleanCpf)) {
      return NextResponse.json(
        { error: "CPF informado é inválido." },
        { status: 400 }
      );
    }

    // 4. Verificar se e-mail, CPF ou Telefone já estão em uso
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: cleanEmail },
          { cpf: cleanCpf },
          { phone: cleanPhone },
        ],
      },
    });

    if (existingUser) {
      let conflictField = "E-mail";
      if (existingUser.cpf === cleanCpf) conflictField = "CPF";
      if (existingUser.phone === cleanPhone) conflictField = "Telefone";

      return NextResponse.json(
        { error: `Este ${conflictField} já está sendo utilizado por outro usuário.` },
        { status: 409 }
      );
    }

    // 5. Verificar se o nome da barbearia já tem um slug em uso
    const barbershopSlug = slugify(barbershopName);
    const existingBarbershop = await prisma.barbershop.findUnique({
      where: { slug: barbershopSlug },
    });

    if (existingBarbershop) {
      return NextResponse.json(
        { error: "Já existe uma barbearia cadastrada com este nome. Tente uma variação." },
        { status: 409 }
      );
    }

    // 6. Encriptar a senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // 7. Transação no banco de dados para criar tudo de forma atômica
    const result = await prisma.$transaction(async (tx) => {
      // 7.1. Criar o Usuário
      const user = await tx.user.create({
        data: {
          name,
          email: cleanEmail,
          phone: cleanPhone,
          cpf: cleanCpf,
          passwordHash: hashedPassword,
          role: "USER", // Papel global de usuário
        },
      });

      // 7.2. Criar a Barbearia (Tenant)
      const barbershop = await tx.barbershop.create({
        data: {
          name: barbershopName,
          slug: barbershopSlug,
          phone: cleanPhone,
          // Valores padrão temporários de endereço
          zipCode: "00000000",
          street: "Rua Não Cadastrada",
          number: "S/N",
          neighborhood: "Centro",
          city: "Cidade Exemplo",
          state: "UF",
        },
      });

      // 7.3. Vincular o Usuário à Barbearia como Proprietário (OWNER)
      const member = await tx.barbershopMember.create({
        data: {
          barbershopId: barbershop.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      // 7.4. Criar categoria padrão de serviços
      const category = await tx.category.create({
        data: {
          barbershopId: barbershop.id,
          name: "Cabelo & Barba",
          slug: "cabelo-e-barba",
        },
      });

      // 7.5. Criar serviço padrão
      const service = await tx.service.create({
        data: {
          barbershopId: barbershop.id,
          categoryId: category.id,
          name: "Corte Masculino Tradicional",
          description: "Corte de cabelo tesoura e máquina clássico.",
          price: 45.00,
          durationMin: 30,
        },
      });

      // 7.6. Associar o barbeiro/owner ao serviço criado
      await tx.barberService.create({
        data: {
          barberId: member.id,
          serviceId: service.id,
        },
      });

      // 7.7. Criar grade padrão de horários para o profissional (Seg a Sáb, 9h às 18h)
      for (let day = 1; day <= 6; day++) {
        await tx.workingHour.create({
          data: {
            memberId: member.id,
            dayOfWeek: day,
            startTime: "09:00",
            endTime: "18:00",
            breakStart: "12:00",
            breakEnd: "13:00",
          },
        });
      }

      return { user, barbershop };
    });

    return NextResponse.json(
      {
        message: "Barbearia e administrador cadastrados com sucesso!",
        userId: result.user.id,
        barbershopId: result.barbershop.id,
        slug: result.barbershop.slug,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Erro no cadastro de barbearia:", error);
    return NextResponse.json(
      { error: "Erro interno no servidor ao realizar o cadastro." },
      { status: 500 }
    );
  }
}
