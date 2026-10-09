import { Suspense } from "react";
import { OePlansDetailsPage } from "@/components/details/OePlansDetailsPage";

export default function DetailsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-muted-foreground">
          Loading OE Plans Details…
        </div>
      }
    >
      <OePlansDetailsPage />
    </Suspense>
  );
}
