import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [MicrosoftEntraID],
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    async jwt({ token, profile }) {
      if (profile?.roles) {
        token.roles = profile.roles as string[];
      }
      return token;
    },
    async session({ session, token }) {
      session.user.roles = (token.roles as string[]) ?? [];
      return session;
    },
  },
});
