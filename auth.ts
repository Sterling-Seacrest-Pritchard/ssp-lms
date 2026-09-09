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
        const email = typeof profile.email === "string" ? profile.email : null;
        const displayName = typeof profile.name === "string" ? profile.name : null;
        if (!email || !displayName) {
          console.error(
            `Skipping user upsert for oid ${profile.oid as string}: Entra profile missing email or name (email=${String(email)}, name=${String(displayName)})`
          );
        } else {
          try {
            await upsertUser({ entraObjectId: profile.oid as string, email, displayName });
          } catch (error) {
            console.error(`Failed to upsert user ${profile.oid as string} on sign-in; session proceeds without it`, error);
          }
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
