import { NextResponse } from "next/server";
import { OperationalError } from "./comandas";

export function operationErrorResponse(error: unknown) {
  if (error instanceof OperationalError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status }
    );
  }
  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "Erro inesperado." }, { status: 500 });
}

