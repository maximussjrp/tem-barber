import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

interface CustomAuthUser {
  id: string;
  role?: string;
  phone?: string;
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 dias
  },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Tem Barber Auth",
      credentials: {
        // Campos para login administrativo
        email: { label: "E-mail ou CPF", type: "text" },
        password: { label: "Senha", type: "password" },
        // Campos para login do cliente (sem senha)
        name: { label: "Nome", type: "text" },
        phone: { label: "Telefone", type: "text" },
        // Tipo de login: "admin" ou "client"
        loginType: { label: "Tipo de Login", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials) return null;

        const { loginType, email, password, name, phone } = credentials;

        // 1. FLUXO DO CLIENTE (Login por Nome + Telefone, sem senha)
        if (loginType === "client") {
          if (!name || !phone) {
            throw new Error("Nome e telefone são obrigatórios para acesso do cliente.");
          }

          // Limpar formatação do telefone para consistência (apenas números)
          const cleanPhone = phone.replace(/\D/g, "");

          if (cleanPhone.length < 10) {
            throw new Error("Telefone inválido. Informe o DDD + Número.");
          }

          // Buscar se o cliente já existe pelo telefone
          let user = await prisma.user.findFirst({
            where: { phone: cleanPhone },
          });

          // Se não existir, cadastramos o cliente automaticamente
          if (!user) {
            user = await prisma.user.create({
              data: {
                name,
                phone: cleanPhone,
                role: "USER",
              },
            });
          }

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
          };
        }

        // 2. FLUXO ADMINISTRATIVO (Barbearia / Profissional - Email ou CPF + Senha)
        if (loginType === "admin") {
          if (!email || !password) {
            throw new Error("E-mail/CPF e senha são obrigatórios.");
          }

          // Tratar se digitou CPF ou e-mail
          const isCpf = /^[0-9.-]+$/.test(email) && email.replace(/\D/g, "").length === 11;
          const cleanIdentifier = isCpf ? email.replace(/\D/g, "") : email.trim().toLowerCase();

          // Buscar usuário pelo E-mail ou CPF
          const user = await prisma.user.findFirst({
            where: {
              OR: [
                { email: cleanIdentifier },
                { cpf: cleanIdentifier },
              ],
            },
          });

          if (!user) {
            throw new Error("Usuário não cadastrado.");
          }

          // Se for cliente comum tentando entrar como admin ou não tiver senha cadastrada
          if (!user.passwordHash) {
            throw new Error("Este usuário não possui senha configurada. Acesse como cliente.");
          }

          // Validar senha
          const isValidPassword = await bcrypt.compare(password, user.passwordHash);

          if (!isValidPassword) {
            throw new Error("Senha incorreta.");
          }

          // Buscar o cargo operacional do usuário na barbearia
          const member = await prisma.barbershopMember.findFirst({
            where: { userId: user.id },
          });

          if (!member && user.role !== "SUPER_ADMIN") {
            throw new Error("Acesso administrativo negado. Você não possui cargos vinculados.");
          }

          const resolvedRole = user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : member?.role;

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: resolvedRole,
          };
        }

        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as CustomAuthUser).role;
        token.phone = (user as CustomAuthUser).phone;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as CustomAuthUser).id = token.id as string;
        (session.user as CustomAuthUser).role = token.role as string;
        (session.user as CustomAuthUser).phone = token.phone as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
