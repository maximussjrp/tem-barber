import { NextResponse } from "next/server";
import { validateStaffAccessToken, consumeStaffAccessToken } from "@/lib/auth/staff-tokens";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Token ausente." }, { status: 400 });
  }

  const result = await validateStaffAccessToken(token);

  if (!result.valid) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: 400 }
    );
  }

  return NextResponse.json({
    valid: true,
    purpose: result.token.purpose,
    userName: result.token.user.name,
    userEmail: result.token.user.email,
    barbershopName: result.token.barbershop.name,
    barbershopSlug: result.token.barbershop.slug,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, password } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token inválido ou ausente." }, { status: 400 });
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "A senha deve ter no mínimo 8 caracteres." },
        { status: 400 }
      );
    }

    const result = await consumeStaffAccessToken(token, password);

    const redirectUrl =
      result.role === "BARBER"
        ? "/member/agenda"
        : result.role === "RECEPTIONIST"
        ? "/admin/agendamentos"
        : "/admin/dashboard";

    return NextResponse.json({
      success: true,
      message: "Senha cadastrada com sucesso!",
      redirectUrl,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "ACTIVATION_FAILED", message: error.message || "Falha ao ativar acesso." },
      { status: 400 }
    );
  }
}
