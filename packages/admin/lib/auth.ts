import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { accounts } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { verifyAccountPassword } from "@/lib/password";
import { AUTH, hasAuthority } from "@flyff/entities/constants/authority";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "GM Account",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const [account] = await db
          .select()
          .from(accounts)
          .where(eq(accounts.username, credentials.username as string))
          .limit(1);

        if (!account) return null;
        // Admin panel requires at least GAME MASTER; normal players can't sign in.
        if (!hasAuthority(account.authority, AUTH.GAMEMASTER)) return null;
        if (account.banned) return null;

        const valid = await verifyAccountPassword(
          credentials.password as string,
          account.passwordHash,
        );
        if (!valid) return null;

        return {
          id: String(account.id),
          name: account.username,
          email: account.email,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ auth: session }) {
      return !!session;
    },
  },
});
