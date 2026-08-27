import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signInAction } from "@/app/actions/auth";

export default async function SignInPage(
  props: PageProps<"/sign-in">
) {
  const session = await auth();
  const searchParams = await props.searchParams;
  const callbackUrl =
    typeof searchParams.callbackUrl === "string" ? searchParams.callbackUrl : "/";

  if (session) {
    redirect(callbackUrl);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-lg">
          <div className="h-1.5 bg-primary" />
          <div className="flex flex-col items-center gap-6 px-8 py-10 text-center">
            <Image
              src="/logo-shield-blue.png"
              alt="Sterling Seacrest Pritchard"
              width={72}
              height={72}
              priority
              className="dark:hidden"
            />
            <Image
              src="/logo-shield-white.png"
              alt="Sterling Seacrest Pritchard"
              width={72}
              height={72}
              priority
              className="hidden dark:block"
            />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">SSP LMS</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in with your Microsoft account to continue
              </p>
            </div>

            <form action={signInAction} className="w-full">
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-3 rounded-lg border bg-background px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
              >
                <MicrosoftLogo />
                Sign in with Microsoft
              </button>
            </form>

            <p className="text-xs text-muted-foreground">
              Access is limited to employees granted a role in Microsoft Entra ID.
            </p>
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Sterling Seacrest Pritchard &middot; SSP LMS internal demo
        </p>
      </div>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
