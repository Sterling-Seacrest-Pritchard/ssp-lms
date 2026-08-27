"use server";

import { signIn, signOut } from "@/auth";

export async function signInAction() {
  await signIn("microsoft-entra-id");
}

export async function signOutAction() {
  await signOut();
}
