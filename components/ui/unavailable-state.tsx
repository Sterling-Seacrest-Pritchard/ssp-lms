import { WifiOff } from "lucide-react";

export function UnavailableState({
  message = "This content is temporarily unavailable. Please try again in a moment.",
}: {
  message?: string;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 py-16 text-center">
      <WifiOff className="h-10 w-10 text-muted-foreground" />
      <p className="text-lg font-medium">Temporarily unavailable</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
