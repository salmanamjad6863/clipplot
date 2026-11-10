import { Suspense } from "react";
import { ReviewDetail } from "./review-detail";

export default function ReviewPage({ params }: PageProps<"/review/[id]">) {
  return (
    <Suspense fallback={<div className="skeleton h-[32rem] rounded-2xl" />}>
      <Resolve params={params} />
    </Suspense>
  );
}

async function Resolve({ params }: { params: PageProps<"/review/[id]">["params"] }) {
  const { id } = await params;
  return <ReviewDetail id={id} />;
}
