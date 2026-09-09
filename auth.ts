import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { upsertUser } from "@/lib/db/users";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [MicrosoftEntraID],
  trustHost: true,
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    async jwt({ token, profile }) {
      if (profile?.roles) {
        token.roles = profile.roles as string[];
      }
      if (profile?.oid) {
        try {
          await upsertUser({
            entraObjectId: profile.oid as string,
            email: profile.email as string,
            displayName: profile.name as string,
          });
        } catch (error) {
          console.error("Failed to upsert user on sign-in; session proceeds without it", error);
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.roles = (token.roles as string[]) ?? [];
      return session;
    },
  },
});
