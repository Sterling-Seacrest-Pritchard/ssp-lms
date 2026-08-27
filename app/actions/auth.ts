"use server";

import { signIn, signOut } from "@/auth";

export async function signInAction(formData?: FormData) {
  const callbackUrl = formData?.get("callbackUrl");
  await signIn(
    "microsoft-entra-id",
    typeof callbackUrl === "string" ? { redirectTo: callbackUrl } : undefined
  );
}

export async function signOutAction() {
  await signOut();
}
